---
name: publish
description: Pre-flight de rede + build completo + upload pro GitHub Releases com validacao SHA
user_invocable: true
---

# /publish — Publish completo do Nexus pro GitHub

Pre-flight de rede, build, upload e validacao. Fluxo seguro contra corrupcao.

## Passo 1 — Pre-flight de rede

Rodar ANTES de qualquer upload:

```powershell
ping -n 2 api.github.com
ping -n 2 uploads.github.com
curl -sI --max-time 8 https://github.com 2>&1 | Select-Object -First 1
```

**Se ping tiver packet loss > 0:**
- Avisar Lucas com diagnostico (qual IP, qual rota)
- Oferecer opcoes: 1) Esperar 2) Bypass via curl --resolve 3) Cancelar
- NAO prosseguir sem confirmacao

**Se tudo OK:** continuar.

## Passo 2 — Verificar versao

```powershell
cd "D:\PROGRAMAÇÃO\NEXUS"
node -e "console.log(require('./package.json').version)"
```

Perguntar ao Lucas: "Publicar como v{versao}?"

## Passo 3 — Build

Verificar se ja existe instalador recente em `dist/`. Se nao:

```powershell
npm run build
```

Timeout 600000ms. Inclui precompile (embed-civil3d.js automatico).

## Passo 4 — Upload (fluxo seguro em 2 fases)

Preferir `gh release create` direto. Se falhar com timeout, usar bypass REST API.

### Fluxo normal:
```powershell
$version = (node -e "console.log(require('./package.json').version)")
$tag = "v$version"
$exe = Get-ChildItem "dist/Nexus Setup*.exe" | Select-Object -First 1
$blockmap = Get-ChildItem "dist/Nexus Setup*.exe.blockmap" | Select-Object -First 1
$latest = "dist/latest.yml"

# Copiar com hifens (GitHub nao aceita espacos)
$safeName = $exe.Name -replace ' ', '-'
Copy-Item $exe.FullName "dist/$safeName"

gh release create $tag "dist/$safeName" $blockmap.FullName $latest --repo A2ZPROJ/codepro --title $tag --notes "Release $tag"
```

### Bypass (se gh falhar com timeout):
Ver procedimento completo na memoria [[publish-timeouts-github]]:
1. Resolver IPs manualmente
2. Criar release via REST API com curl --resolve
3. Upload assets via uploads.github.com
4. Validar SHA

## Passo 5 — Validar integridade

```powershell
certutil -hashfile "dist/$safeName" SHA256
```

Comparar com SHA no latest.yml. Se bater, confirmar sucesso. Se nao, avisar e deletar release.

## Passo 6 — Instalar DLL no bundle local

```powershell
node scripts/c3d-install-dev.js
```

## Resultado final

Mostrar:
- Tag publicada
- URL do release no GitHub
- SHA validado OK/FAIL
- "Lucas: feche o Civil 3D e reabra pra carregar a DLL nova"

## NUNCA fazer
- Usar `npm run build:publish` sem checar rede antes
- Publicar sem validar SHA
- Ignorar packet loss e tentar upload assim mesmo
