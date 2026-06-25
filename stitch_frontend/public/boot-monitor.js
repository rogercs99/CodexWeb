/* global window, document, navigator, localStorage, sessionStorage, caches */
(function codexBootMonitorInit() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CODEXWEB_BOOT_MONITOR__) return;

  var BOOT_TIMEOUT_MS = 12000;
  var ROOT_EMPTY_TIMEOUT_MS = 17000;
  var REPORT_TIMEOUT_MS = 2200;
  var MAX_LOG_LINES = 200;
  var MAX_ERROR_LINES = 40;
  var VERSION = '20260509-ios-debug-1';

  function nowIso() {
    return new Date().toISOString();
  }

  function hasQueryFlag(flagName) {
    var target = String(flagName || '').trim().toLowerCase();
    if (!target) return false;
    var search = String((window.location && window.location.search) || '');
    if (!search) return false;
    var parts = search.replace(/^\?/, '').split('&');
    for (var i = 0; i < parts.length; i += 1) {
      var entry = String(parts[i] || '');
      if (!entry) continue;
      var split = entry.split('=');
      var key = decodeURIComponent(String(split[0] || '')).trim().toLowerCase();
      if (key !== target) continue;
      if (split.length === 1) return true;
      var value = decodeURIComponent(String(split.slice(1).join('=') || '')).trim().toLowerCase();
      return value === '' || value === '1' || value === 'true' || value === 'yes' || value === 'on';
    }
    return false;
  }

  function compactText(value, maxLen) {
    var text = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
    var limit = Number(maxLen) > 0 ? Number(maxLen) : 260;
    if (!text) return '';
    if (text.length <= limit) return text;
    return text.slice(0, Math.max(0, limit - 1)).trim() + '…';
  }

  function firstWords(value, maxLen) {
    return compactText(value, maxLen || 600);
  }

  function onBodyReady(callback) {
    if (typeof callback !== 'function') return;
    if (document.body) {
      callback();
      return;
    }
    var invoked = false;
    var run = function runOnBodyReady() {
      if (invoked) return;
      if (!document.body) return;
      invoked = true;
      document.removeEventListener('DOMContentLoaded', run);
      callback();
    };
    document.addEventListener('DOMContentLoaded', run);
    window.setTimeout(run, 1200);
  }

  function getRootNode() {
    var root = document.getElementById('root');
    if (root) return root;
    if (!document.body) return null;
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    return root;
  }

  var bootStartedAtMs = Date.now();
  var debugEnabled = hasQueryFlag('debug');
  var safeModeEnabled = hasQueryFlag('safe');
  var bootCompleted = false;
  var fatalShown = false;
  var lastFatalCode = '';
  var overlayNode = null;
  var logs = [];
  var errors = [];

  function mark(step, detail) {
    var safeStep = compactText(step || 'STEP', 80) || 'STEP';
    var safeDetail = compactText(detail || '', 400);
    logs.push({
      at: nowIso(),
      step: safeStep,
      detail: safeDetail,
      elapsedMs: Math.max(0, Date.now() - bootStartedAtMs)
    });
    if (logs.length > MAX_LOG_LINES) {
      logs = logs.slice(logs.length - MAX_LOG_LINES);
    }
    if (debugEnabled) renderDebugOverlay();
  }

  function rememberError(code, message, detail) {
    var safeCode = compactText(code || 'UNKNOWN', 80) || 'UNKNOWN';
    var safeMessage = compactText(message || '', 320);
    var safeDetail = compactText(detail || '', 900);
    errors.push({
      at: nowIso(),
      code: safeCode,
      message: safeMessage,
      detail: safeDetail,
      elapsedMs: Math.max(0, Date.now() - bootStartedAtMs)
    });
    if (errors.length > MAX_ERROR_LINES) {
      errors = errors.slice(errors.length - MAX_ERROR_LINES);
    }
    mark('ERROR_' + safeCode, safeMessage || safeDetail || 'sin detalle');
  }

  function listStylesheetHrefs() {
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    var result = [];
    for (var i = 0; i < links.length; i += 1) {
      var href = String((links[i] && links[i].getAttribute('href')) || '').trim();
      if (href) result.push(href);
    }
    return result;
  }

  function findMainScriptSource() {
    var scripts = document.querySelectorAll('script[type="module"],script[src]');
    for (var i = 0; i < scripts.length; i += 1) {
      var src = String((scripts[i] && scripts[i].getAttribute('src')) || '').trim();
      if (!src) continue;
      if (src.indexOf('/assets/index-') >= 0 || src.indexOf('/src/main.tsx') >= 0) {
        return src;
      }
    }
    return '';
  }

  function getFeatureSnapshot() {
    var features = {
      promise: typeof window.Promise === 'function',
      fetch: typeof window.fetch === 'function',
      moduleScript: (function checkModuleSupport() {
        var probe = document.createElement('script');
        return 'noModule' in probe;
      })(),
      asyncAwait: false,
      eventSource: typeof window.EventSource === 'function',
      webSocket: typeof window.WebSocket === 'function',
      localStorage: false,
      sessionStorage: false,
      indexedDB: typeof window.indexedDB !== 'undefined',
      cookieEnabled: !!(navigator && navigator.cookieEnabled)
    };
    try {
      features.asyncAwait = Boolean(Function('return (async function(){return 1;})')());
    } catch (_error) {
      features.asyncAwait = false;
    }
    try {
      var keyA = '__codexweb_boot_ls__';
      window.localStorage.setItem(keyA, '1');
      window.localStorage.removeItem(keyA);
      features.localStorage = true;
    } catch (_error) {
      features.localStorage = false;
    }
    try {
      var keyB = '__codexweb_boot_ss__';
      window.sessionStorage.setItem(keyB, '1');
      window.sessionStorage.removeItem(keyB);
      features.sessionStorage = true;
    } catch (_error) {
      features.sessionStorage = false;
    }
    return features;
  }

  function buildDiagPayload(extra) {
    var root = document.getElementById('root');
    var rootText = root ? compactText(root.textContent || '', 200) : '';
    var rootChildren = root ? root.children.length : 0;
    var payload = {
      kind: 'boot_monitor',
      code: compactText(extra && extra.code ? extra.code : '', 80),
      stage: compactText(extra && extra.stage ? extra.stage : '', 80),
      message: compactText(extra && extra.message ? extra.message : '', 320),
      detail: compactText(extra && extra.detail ? extra.detail : '', 1200),
      timestamp: nowIso(),
      elapsedMs: Math.max(0, Date.now() - bootStartedAtMs),
      url: String((window.location && window.location.href) || ''),
      userAgent: String((navigator && navigator.userAgent) || ''),
      language: String((navigator && navigator.language) || ''),
      platform: String((navigator && navigator.platform) || ''),
      cookieEnabled: !!(navigator && navigator.cookieEnabled),
      debugEnabled: debugEnabled,
      safeModeEnabled: safeModeEnabled,
      bootCompleted: bootCompleted,
      fatalShown: fatalShown,
      mainScriptSrc: findMainScriptSource(),
      stylesheetHrefs: listStylesheetHrefs(),
      rootChildren: rootChildren,
      rootText: rootText,
      features: getFeatureSnapshot(),
      lastLogs: logs.slice(Math.max(0, logs.length - 60)),
      lastErrors: errors.slice(Math.max(0, errors.length - 20))
    };
    return payload;
  }

  function postJson(endpoint, payload, callback) {
    var body = JSON.stringify(payload || {});
    var done = false;
    function finish(ok) {
      if (done) return;
      done = true;
      if (typeof callback === 'function') {
        try {
          callback(Boolean(ok));
        } catch (_error) {
          // ignore callback errors
        }
      }
    }

    try {
      if (navigator && typeof navigator.sendBeacon === 'function') {
        var beaconBlob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(endpoint, beaconBlob)) {
          finish(true);
          return;
        }
      }
    } catch (_error) {
      // ignore sendBeacon errors
    }

    if (typeof window.fetch === 'function') {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      if (ctrl) {
        window.setTimeout(function abortSlowReport() {
          try {
            ctrl.abort();
          } catch (_error) {
            // ignore
          }
        }, REPORT_TIMEOUT_MS);
      }
      window
        .fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          credentials: 'same-origin',
          keepalive: true,
          signal: ctrl ? ctrl.signal : undefined
        })
        .then(function () {
          finish(true);
        })
        .catch(function () {
          finish(false);
        });
      return;
    }

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = REPORT_TIMEOUT_MS;
      xhr.onreadystatechange = function onXhrDone() {
        if (xhr.readyState === 4) {
          finish(xhr.status >= 200 && xhr.status < 300);
        }
      };
      xhr.onerror = function onXhrError() {
        finish(false);
      };
      xhr.ontimeout = function onXhrTimeout() {
        finish(false);
      };
      xhr.send(body);
    } catch (_error) {
      finish(false);
    }
  }

  function reportBootstrapError(code, message, detail) {
    var payload = {
      stage: compactText(code || 'BOOTSTRAP_ERROR', 80),
      message: compactText(message || 'frontend_bootstrap_error', 320),
      detail: compactText(detail || '', 1200),
      path: String((window.location && window.location.href) || ''),
      userAgent: String((navigator && navigator.userAgent) || ''),
      elapsedMs: Math.max(0, Date.now() - bootStartedAtMs)
    };
    postJson('/api/frontend/bootstrap-error', payload);
  }

  function sendDiagReport(extra, callback) {
    var payload = buildDiagPayload(extra || {});
    postJson('/api/frontend/diag-report', payload, callback);
  }

  function copyDiagnostics() {
    var payload = buildDiagPayload({ stage: 'copy_diagnostic' });
    var text = JSON.stringify(payload, null, 2);
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).catch(function () {
        // ignore
      });
    }
  }

  function clearClientCachesAndReload() {
    mark('CACHE_CLEAR_START', 'Limpiando cache local y recargando');

    function finishReload() {
      var nextUrl = String(window.location.pathname || '/') + '?reload=' + Date.now();
      try {
        window.location.replace(nextUrl);
      } catch (_error) {
        window.location.href = nextUrl;
      }
    }

    var waiters = [];

    try {
      if (window.localStorage) {
        window.localStorage.clear();
      }
    } catch (_error) {
      // ignore
    }

    try {
      if (window.sessionStorage) {
        window.sessionStorage.clear();
      }
    } catch (_error) {
      // ignore
    }

    if (navigator && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
      try {
        var swPromise = navigator.serviceWorker
          .getRegistrations()
          .then(function (registrations) {
            return Promise.all(
              (registrations || []).map(function (registration) {
                try {
                  return registration.unregister();
                } catch (_error) {
                  return false;
                }
              })
            );
          })
          .catch(function () {
            return [];
          });
        waiters.push(swPromise);
      } catch (_error) {
        // ignore
      }
    }

    if (window.caches && typeof window.caches.keys === 'function') {
      try {
        var cachePromise = window.caches
          .keys()
          .then(function (keys) {
            return Promise.all(
              (keys || []).map(function (key) {
                try {
                  return window.caches.delete(key);
                } catch (_error) {
                  return false;
                }
              })
            );
          })
          .catch(function () {
            return [];
          });
        waiters.push(cachePromise);
      } catch (_error) {
        // ignore
      }
    }

    if (waiters.length === 0) {
      finishReload();
      return;
    }

    Promise.all(
      waiters.map(function (entry) {
        return Promise.resolve(entry).catch(function () {
          return null;
        });
      })
    )
      .then(function () {
        finishReload();
      })
      .catch(function () {
        finishReload();
      });
  }

  function ensureOverlay() {
    if (overlayNode && overlayNode.parentNode) return overlayNode;
    if (!document.body) {
      onBodyReady(function renderOverlayWhenBodyReady() {
        renderDebugOverlay();
      });
      return null;
    }
    var node = document.createElement('aside');
    node.id = 'codexweb-boot-debug-overlay';
    node.style.position = 'fixed';
    node.style.left = '8px';
    node.style.right = '8px';
    node.style.bottom = '8px';
    node.style.maxHeight = '48vh';
    node.style.zIndex = '2147483646';
    node.style.background = 'rgba(5,8,12,0.95)';
    node.style.border = '1px solid #334155';
    node.style.borderRadius = '12px';
    node.style.color = '#e2e8f0';
    node.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
    node.style.fontSize = '11px';
    node.style.lineHeight = '1.35';
    node.style.padding = '8px';
    node.style.overflow = 'auto';
    document.body.appendChild(node);
    overlayNode = node;
    return node;
  }

  function formatLogLine(entry) {
    var elapsed = String(entry && entry.elapsedMs ? entry.elapsedMs : 0);
    var step = compactText(entry && entry.step ? entry.step : 'STEP', 80);
    var detail = compactText(entry && entry.detail ? entry.detail : '', 180);
    return '[' + elapsed + 'ms] ' + step + (detail ? ' · ' + detail : '');
  }

  function renderDebugOverlay() {
    if (!debugEnabled && !fatalShown) return;
    var node = ensureOverlay();
    if (!node) return;
    var recentLogs = logs.slice(Math.max(0, logs.length - 18));
    var recentErrors = errors.slice(Math.max(0, errors.length - 6));

    node.innerHTML = '';

    var header = document.createElement('div');
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.gap = '8px';

    var title = document.createElement('strong');
    title.textContent = 'CodexWeb DEV Debug';
    title.style.color = '#93c5fd';

    var summary = document.createElement('span');
    summary.textContent =
      't=' +
      String(Math.max(0, Date.now() - bootStartedAtMs)) +
      'ms · boot=' +
      (bootCompleted ? 'ok' : 'pending') +
      ' · safe=' +
      (safeModeEnabled ? '1' : '0');
    summary.style.color = '#94a3b8';

    header.appendChild(title);
    header.appendChild(summary);

    var buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    buttonRow.style.flexWrap = 'wrap';
    buttonRow.style.gap = '6px';
    buttonRow.style.marginTop = '8px';

    function makeButton(label, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.style.background = '#0f172a';
      btn.style.color = '#e2e8f0';
      btn.style.border = '1px solid #334155';
      btn.style.borderRadius = '8px';
      btn.style.padding = '5px 8px';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', onClick);
      return btn;
    }

    buttonRow.appendChild(
      makeButton('Copiar diagnostico', function onCopy() {
        copyDiagnostics();
      })
    );
    buttonRow.appendChild(
      makeButton('Enviar diagnostico', function onSend() {
        sendDiagReport({ stage: 'debug_overlay_send', code: fatalShown ? lastFatalCode : '' });
      })
    );
    buttonRow.appendChild(
      makeButton('Limpiar cache y recargar', function onClear() {
        clearClientCachesAndReload();
      })
    );
    buttonRow.appendChild(
      makeButton('Abrir /diag', function onDiag() {
        window.location.href = '/diag';
      })
    );

    var logsTitle = document.createElement('div');
    logsTitle.textContent = 'Bootstrap logs';
    logsTitle.style.marginTop = '8px';
    logsTitle.style.color = '#cbd5e1';

    var logsBox = document.createElement('pre');
    logsBox.style.margin = '6px 0 0 0';
    logsBox.style.whiteSpace = 'pre-wrap';
    logsBox.style.color = '#e2e8f0';
    logsBox.textContent = recentLogs.map(formatLogLine).join('\n') || '(sin eventos)';

    node.appendChild(header);
    node.appendChild(buttonRow);

    if (recentErrors.length > 0) {
      var errTitle = document.createElement('div');
      errTitle.textContent = 'Errores';
      errTitle.style.marginTop = '8px';
      errTitle.style.color = '#fda4af';

      var errBox = document.createElement('pre');
      errBox.style.margin = '6px 0 0 0';
      errBox.style.whiteSpace = 'pre-wrap';
      errBox.style.color = '#fecdd3';
      errBox.textContent = recentErrors
        .map(function (entry) {
          return (
            '[' + String(entry.elapsedMs || 0) + 'ms] ' + compactText(entry.code, 50) + ': ' + compactText(entry.message, 220)
          );
        })
        .join('\n');

      node.appendChild(errTitle);
      node.appendChild(errBox);
    }

    node.appendChild(logsTitle);
    node.appendChild(logsBox);
  }

  function showFatal(payload) {
    if (bootCompleted) return;

    var code = compactText(payload && payload.code ? payload.code : 'BOOT_FATAL', 80) || 'BOOT_FATAL';
    var message = compactText(payload && payload.message ? payload.message : 'Fallo critico al iniciar la aplicacion', 320);
    var detail = compactText(payload && payload.detail ? payload.detail : '', 900);
    var stage = compactText(payload && payload.stage ? payload.stage : code, 80);

    if (fatalShown && code === lastFatalCode) {
      renderDebugOverlay();
      return;
    }

    fatalShown = true;
    lastFatalCode = code;
    rememberError(code, message, detail);

    reportBootstrapError(code, message, detail);
    sendDiagReport({ code: code, stage: stage, message: message, detail: detail });

    var root = getRootNode();
    if (!root) {
      onBodyReady(function retryFatalRender() {
        showFatal(payload || {});
      });
      return;
    }
    root.innerHTML = '';
    root.style.minHeight = '100vh';
    root.style.background = '#000';
    root.style.color = '#fff';
    root.style.display = 'flex';
    root.style.alignItems = 'center';
    root.style.justifyContent = 'center';
    root.style.padding = '24px';
    root.style.boxSizing = 'border-box';
    root.style.fontFamily = "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";

    var panel = document.createElement('section');
    panel.style.width = '100%';
    panel.style.maxWidth = '620px';
    panel.style.border = '1px solid #334155';
    panel.style.background = 'rgba(9,11,14,0.95)';
    panel.style.borderRadius = '16px';
    panel.style.padding = '16px';

    var heading = document.createElement('h1');
    heading.textContent = 'La aplicacion no pudo cargarse';
    heading.style.margin = '0 0 10px 0';
    heading.style.fontSize = '20px';

    var codeLine = document.createElement('p');
    codeLine.style.margin = '0 0 8px 0';
    codeLine.style.color = '#93c5fd';
    codeLine.style.fontSize = '12px';
    codeLine.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
    codeLine.textContent = 'Codigo: ' + code;

    var messageLine = document.createElement('p');
    messageLine.style.margin = '0 0 8px 0';
    messageLine.style.color = '#e2e8f0';
    messageLine.style.fontSize = '14px';
    messageLine.textContent = message;

    var detailLine = document.createElement('p');
    detailLine.style.margin = '0 0 12px 0';
    detailLine.style.color = '#94a3b8';
    detailLine.style.fontSize = '12px';
    detailLine.textContent = detail || 'Sin detalle adicional.';

    var actions = document.createElement('div');
    actions.style.display = 'grid';
    actions.style.gridTemplateColumns = '1fr';
    actions.style.gap = '8px';

    function makeAction(label, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.style.border = '1px solid #334155';
      btn.style.background = '#0f172a';
      btn.style.color = '#e2e8f0';
      btn.style.padding = '10px 12px';
      btn.style.borderRadius = '10px';
      btn.style.fontWeight = '600';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', onClick);
      return btn;
    }

    actions.appendChild(
      makeAction('Enviar error', function onSendError() {
        sendDiagReport({ code: code, stage: stage, message: message, detail: detail });
        reportBootstrapError(code, message, detail);
      })
    );
    actions.appendChild(
      makeAction('Limpiar cache y reintentar', function onRetry() {
        clearClientCachesAndReload();
      })
    );
    actions.appendChild(
      makeAction('Abrir diagnostico', function onOpenDiag() {
        window.location.href = '/diag';
      })
    );

    panel.appendChild(heading);
    panel.appendChild(codeLine);
    panel.appendChild(messageLine);
    panel.appendChild(detailLine);
    panel.appendChild(actions);
    root.appendChild(panel);

    renderDebugOverlay();
  }

  function onGlobalError(event) {
    var err = event && event.error ? event.error : null;
    var message = compactText((err && err.message) || (event && event.message) || 'global_error', 320);
    var stack = compactText((err && err.stack) || '', 1000);
    showFatal({
      code: 'GLOBAL_ERROR',
      stage: 'window_error',
      message: message || 'Error global en arranque',
      detail: stack || message || 'Sin detalle'
    });
  }

  function onUnhandledRejection(event) {
    var reason = event && typeof event === 'object' ? event.reason : '';
    var message = '';
    var detail = '';

    if (reason && typeof reason === 'object') {
      message = compactText(reason.message || 'promise_rejection', 320);
      detail = compactText(reason.stack || '', 1000);
      if (!detail) {
        try {
          detail = compactText(JSON.stringify(reason), 1000);
        } catch (_error) {
          detail = message;
        }
      }
    } else {
      message = compactText(reason || 'promise_rejection', 320);
      detail = message;
    }

    showFatal({
      code: 'UNHANDLED_REJECTION',
      stage: 'unhandled_rejection',
      message: message || 'Promesa rechazada en arranque',
      detail: detail || 'Sin detalle'
    });
  }

  function onScriptError(event) {
    var target = event && (event.target || event.srcElement);
    if (!target || !target.tagName) return;
    var tag = String(target.tagName || '').toLowerCase();
    if (tag !== 'script') return;
    var src = compactText(String(target.src || target.getAttribute('src') || ''), 360);
    showFatal({
      code: 'SCRIPT_LOAD_ERROR',
      stage: 'script_load',
      message: src ? 'No se pudo cargar un script esencial' : 'Error de carga de script',
      detail: src || 'Script principal no disponible'
    });
  }

  function onStylesheetError(event) {
    var target = event && (event.target || event.srcElement);
    if (!target || !target.tagName) return;
    var tag = String(target.tagName || '').toLowerCase();
    if (tag !== 'link') return;
    var rel = String(target.rel || target.getAttribute('rel') || '').toLowerCase();
    if (rel.indexOf('stylesheet') === -1) return;
    var href = compactText(String(target.href || target.getAttribute('href') || ''), 360);
    showFatal({
      code: 'CSS_LOAD_ERROR',
      stage: 'css_load',
      message: 'No se pudo cargar la hoja de estilos principal',
      detail: href || 'stylesheet no disponible'
    });
  }

  function checkRootAfterTimeout() {
    if (bootCompleted || fatalShown) return;
    var root = document.getElementById('root');
    var hasChildren = root && root.children && root.children.length > 0;
    var hasText = root && compactText(root.textContent || '', 80).length > 0;
    if (!hasChildren && !hasText) {
      showFatal({
        code: 'ROOT_EMPTY',
        stage: 'root_empty',
        message: 'El contenedor principal sigue vacio',
        detail: 'React no monto contenido util en #root.'
      });
      return;
    }
    showFatal({
      code: 'BOOT_TIMEOUT',
      stage: 'boot_timeout',
      message: 'El arranque tardo demasiado',
      detail: 'El frontend no confirmo inicio completo en el tiempo esperado.'
    });
  }

  function onBootTimeout() {
    if (bootCompleted || fatalShown) return;
    showFatal({
      code: 'BOOT_TIMEOUT',
      stage: 'boot_timeout',
      message: 'Tiempo de arranque agotado',
      detail: 'No se detecto inicio correcto del frontend.'
    });
  }

  window.__CODEXWEB_BOOT_MONITOR__ = {
    version: VERSION,
    mark: function markPublic(step, detail) {
      mark(step, detail);
    },
    markBooted: function markBootedPublic() {
      bootCompleted = true;
      mark('APP_RENDER_DONE', 'React confirmo montaje');
      renderDebugOverlay();
    },
    showFatal: function showFatalPublic(payload) {
      showFatal(payload || {});
    },
    report: function reportPublic(payload) {
      var safePayload = payload && typeof payload === 'object' ? payload : {};
      var code = compactText(safePayload.code || safePayload.stage || 'BOOT_REPORT', 80);
      var message = compactText(safePayload.message || 'frontend_bootstrap_report', 320);
      var detail = compactText(safePayload.detail || '', 1200);
      reportBootstrapError(code, message, detail);
    },
    sendDiagReport: function sendDiagReportPublic(payload) {
      sendDiagReport(payload || {});
    },
    copyDiagnostics: function copyDiagnosticsPublic() {
      copyDiagnostics();
    },
    clearCacheAndReload: function clearCacheAndReloadPublic() {
      clearClientCachesAndReload();
    },
    getSnapshot: function getSnapshotPublic() {
      return buildDiagPayload({ stage: 'snapshot' });
    }
  };

  mark('BOOT_MONITOR_LOADED', 'version=' + VERSION + (debugEnabled ? ' debug=1' : ' debug=0'));
  if (safeModeEnabled) {
    mark('SAFE_MODE_ENABLED', 'safe=1');
  }

  if (navigator && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
    navigator.serviceWorker
      .getRegistrations()
      .then(function (registrations) {
        if (!registrations || registrations.length === 0) return;
        mark('SERVICE_WORKER_FOUND', 'registrations=' + registrations.length);
        if (safeModeEnabled) {
          return Promise.all(
            registrations.map(function (registration) {
              try {
                return registration.unregister();
              } catch (_error) {
                return false;
              }
            })
          ).then(function () {
            mark('SERVICE_WORKER_UNREGISTERED', 'safe mode cleanup');
          });
        }
      })
      .catch(function () {
        // ignore
      });
  }

  window.addEventListener('error', onGlobalError);
  window.addEventListener('error', onScriptError, true);
  window.addEventListener('error', onStylesheetError, true);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  window.setTimeout(onBootTimeout, BOOT_TIMEOUT_MS);
  window.setTimeout(checkRootAfterTimeout, ROOT_EMPTY_TIMEOUT_MS);

  if (debugEnabled) {
    onBodyReady(function renderInitialDebugOverlay() {
      renderDebugOverlay();
    });
  }
})();
