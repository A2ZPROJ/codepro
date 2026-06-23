// src/app/js/core/utils.js
// Utilitários de uso geral do renderer. Expostos como ESM (import) e como
// global (window.esc) pra compatibilidade com scripts não-module ainda
// presentes no index.html durante a modularização incremental.

export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (typeof window !== 'undefined') {
  window.esc = esc;
}
