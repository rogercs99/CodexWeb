/* global window, document */
(function legacyBootstrapNotice() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var root = document.getElementById('root');
  if (!root) return;

  var panel = document.createElement('div');
  panel.style.minHeight = '100vh';
  panel.style.display = 'flex';
  panel.style.alignItems = 'center';
  panel.style.justifyContent = 'center';
  panel.style.padding = '24px';
  panel.style.background = '#000';
  panel.style.color = '#fff';
  panel.style.fontFamily = "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

  panel.innerHTML =
    '<div style="width:100%;max-width:580px;background:rgba(12,12,12,.94);border:1px solid #334155;border-radius:14px;padding:16px;">' +
    '<h1 style="margin:0 0 10px 0;font-size:20px;">La aplicacion no pudo cargarse</h1>' +
    '<p style="margin:0 0 8px 0;color:#e2e8f0;">Tu navegador no soporta el modo de carga actual.</p>' +
    '<p style="margin:0 0 12px 0;color:#94a3b8;font-size:12px;">Abre diagnostico para enviar reporte desde este dispositivo.</p>' +
    '<a href="/diag" style="display:inline-block;padding:9px 12px;border-radius:10px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;text-decoration:none;">Abrir diagnostico</a>' +
    '</div>';

  root.innerHTML = '';
  root.appendChild(panel);
})();
