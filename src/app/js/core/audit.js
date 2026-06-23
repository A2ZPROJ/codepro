// src/app/js/core/audit.js
console.log('[audit] module loading at', new Date().toISOString());
if (typeof window !== 'undefined') window.__auditLoadedAt = Date.now();
// Camada de auditoria: emite events pro Supabase + arquivo JSONL local.
// Coleta IP público, geolocalização (cidade via IP + rua via navigator.geolocation
// quando permitido pelo user) e versão do app.
//
// Uso:
//   await audit.init(currentUser, appVersion)   // 1x no bootstrap pós-login
//   audit.log('event_type', { ...payload })     // qualquer evento
//   audit.startHeartbeat()                      // dispara update_presence a cada 60s
//
// Resiliente: se Supabase falhar, ainda grava no log local. Janela offline
// fica registrada localmente; futuras Fases podem fazer sync up.

const audit = (() => {
  const state = {
    user: null,            // { id, nome, access_code }
    appVersion: null,
    ip: null,
    geo: null,             // { lat, lng, accuracy, city, region, country, source }
    geoFinePromise: null,  // promise da getCurrentPosition (~rua)
    heartbeatTimer: null,
    inited: false,
  };

  function userAgent() {
    try { return navigator.userAgent; } catch { return null; }
  }

  // — coleta IP público + geo via main process (Node https, sem CSP) —
  async function fetchIpGeo() {
    try {
      const result = await window.electronAPI?.auditLog?.fetchIpGeo?.();
      if (result?.ip)  state.ip = result.ip;
      if (result?.geo) state.geo = { ...result.geo, accuracy: null };
      console.log('[audit] fetchIpGeo (main) →', { ip: state.ip, city: state.geo?.city });
    } catch (e) { console.warn('[audit] fetchIpGeo (main) falhou:', e?.message || e); }
  }

  // — geolocalização precisa (~rua) via main process: Wi-Fi scan + Google
  // Geolocation API. Bypassa o bug do Chromium do Electron 29.
  // Cacheada em state.geoFinePromise: só 1 chamada à Google API por sessão.
  function fetchGeoFine() {
    if (state.geoFinePromise) return state.geoFinePromise;
    state.geoFinePromise = (async () => {
      try {
        const r = await window.electronAPI?.auditLog?.fetchGeoFine?.();
        if (r && r.lat != null && r.lng != null) {
          const fine = {
            lat: r.lat,
            lng: r.lng,
            accuracy: r.accuracy,
            city:    state.geo?.city    || null,
            region:  state.geo?.region  || null,
            country: state.geo?.country || null,
            source:  'gps',
          };
          console.log('[audit] FINE via Wi-Fi+Google ok:', fine.lat, fine.lng, '~' + Math.round(fine.accuracy) + 'm', '(' + r.wifi_count + ' wifis)');
          try {
            window.electronAPI?.auditLog?.append({
              event: '__geo_diag', ok: true,
              accuracy: fine.accuracy, lat: fine.lat, lng: fine.lng,
              wifi_count: r.wifi_count,
              ts: new Date().toISOString(),
            });
          } catch {}
          state.geo = fine; // sobrescreve com geo precisa
          return fine;
        } else {
          console.warn('[audit] FINE falhou:', r?.error || 'sem dados', 'wifi=' + (r?.wifi_count ?? '?'));
          try {
            window.electronAPI?.auditLog?.append({
              event: '__geo_diag', ok: false,
              err: r?.error || 'unknown',
              wifi_count: r?.wifi_count,
              ts: new Date().toISOString(),
            });
          } catch {}
          return null;
        }
      } catch (e) {
        console.warn('[audit] fetchGeoFine throw:', e.message);
        return null;
      }
    })();
    return state.geoFinePromise;
  }

  async function init(user, appVersion) {
    if (state.inited) return;
    state.user = user || null;
    state.appVersion = appVersion || null;
    state.inited = true;
    console.log('[audit] init', { user: user?.nome, appVersion });
    try { await fetchIpGeo(); } catch {}
    fetchGeoFine().then((fine) => { if (fine) heartbeat(); });

    // Estratégia de retry pra contornar cache do netsh wlan:
    // — 5 retries a cada 60s logo após o boot (chance de pegar scan recente do Win)
    // — depois, retry a cada 10min indefinidamente
    // Cada retry só roda se accuracy atual ainda for ruim (>200m) — uma boa
    // resposta encerra o loop até nova queda.
    let earlyRetries = 0;
    const earlyTimer = setInterval(async () => {
      const acc = state.geo?.accuracy;
      if (acc != null && acc < 200) {
        clearInterval(earlyTimer);
        return;
      }
      earlyRetries++;
      console.log('[audit] retry early #' + earlyRetries + ' (acc=' + acc + ')');
      state.geoFinePromise = null;
      const fine = await fetchGeoFine();
      if (fine) heartbeat();
      if (earlyRetries >= 5) clearInterval(earlyTimer);
    }, 60 * 1000);

    setInterval(async () => {
      const acc = state.geo?.accuracy;
      if (acc == null || acc > 500) {
        state.geoFinePromise = null;
        const fine = await fetchGeoFine();
        if (fine) heartbeat();
      }
    }, 10 * 60 * 1000);
  }

  function buildPayload(eventType, payload) {
    return {
      p_caller_code:  state.user?.access_code || null,
      p_event_type:   String(eventType || 'unknown'),
      p_payload:      payload || null,
      p_app_version:  state.appVersion,
      p_ip_address:   state.ip,
      p_geo_lat:      state.geo?.lat ?? null,
      p_geo_lng:      state.geo?.lng ?? null,
      p_geo_accuracy: state.geo?.accuracy ?? null,
      p_geo_city:     state.geo?.city ?? null,
      p_geo_region:   state.geo?.region ?? null,
      p_geo_country:  state.geo?.country ?? null,
      p_geo_source:   state.geo?.source ?? null,
      p_user_agent:   userAgent(),
    };
  }

  async function log(eventType, payload) {
    if (!state.inited || !state.user?.access_code) return;
    const args = buildPayload(eventType, payload);

    // Log local primeiro (sempre tenta, mesmo offline) — fire-and-forget
    try {
      window.electronAPI?.auditLog?.append({
        event:       eventType,
        user_id:     state.user.id,
        user_nome:   state.user.nome,
        payload:     payload || null,
        app_version: state.appVersion,
        ip:          state.ip,
        geo:         state.geo,
        ua:          userAgent(),
      });
    } catch {}

    // Supabase (best-effort)
    try {
      const sb = window.sb;
      if (sb && navigator.onLine) {
        await sb.rpc('log_event', args);
      }
    } catch (e) { console.warn('[audit] log_event falhou:', e.message); }
  }

  async function heartbeat() {
    if (!state.inited || !state.user?.access_code) return;
    if (!navigator.onLine) return;
    try {
      const sb = window.sb;
      if (!sb) return;
      await sb.rpc('update_presence', {
        p_caller_code:  state.user.access_code,
        p_app_version:  state.appVersion,
        p_ip_address:   state.ip,
        p_geo_lat:      state.geo?.lat ?? null,
        p_geo_lng:      state.geo?.lng ?? null,
        p_geo_accuracy: state.geo?.accuracy ?? null,
        p_geo_city:     state.geo?.city ?? null,
        p_geo_region:   state.geo?.region ?? null,
        p_geo_country:  state.geo?.country ?? null,
        p_geo_source:   state.geo?.source ?? null,
        p_user_agent:   userAgent(),
      });
    } catch (e) { console.warn('[audit] heartbeat falhou:', e.message); }
  }

  function startHeartbeat(intervalMs = 60 * 1000) {
    stopHeartbeat();
    // Primeiro tick imediato pra registrar presence assim que loga
    heartbeat();
    state.heartbeatTimer = setInterval(heartbeat, intervalMs);
  }

  function stopHeartbeat() {
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  }

  return { init, log, heartbeat, startHeartbeat, stopHeartbeat, _state: state };
})();

if (typeof window !== 'undefined') {
  window.audit = audit;
}

export default audit;
