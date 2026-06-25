/* global window, document, navigator, localStorage, sessionStorage, caches */
(function codexDiagPageInit() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var state = {
    createdAt: new Date().toISOString(),
    errors: [],
    network: {},
    version: null,
    health: null,
    mainScript: '',
    mainCss: ''
  };

  function compactText(value, maxLen) {
    var text = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
    var limit = Number(maxLen) > 0 ? Number(maxLen) : 260;
    if (!text) return '';
    if (text.length <= limit) return text;
    return text.slice(0, Math.max(0, limit - 1)).trim() + '…';
  }

  function appendError(kind, message, detail) {
    state.errors.push({
      at: new Date().toISOString(),
      kind: compactText(kind || 'error', 80),
      message: compactText(message || '', 320),
      detail: compactText(detail || '', 900)
    });
    if (state.errors.length > 30) {
      state.errors = state.errors.slice(state.errors.length - 30);
    }
    renderErrorLog();
    renderPayloadPreview();
  }

  window.addEventListener('error', function onDiagError(event) {
    var err = event && event.error ? event.error : null;
    appendError('window_error', (event && event.message) || (err && err.message) || 'window_error', err && err.stack);
  });

  window.addEventListener('unhandledrejection', function onDiagRejection(event) {
    var reason = event && typeof event === 'object' ? event.reason : '';
    if (reason && typeof reason === 'object') {
      appendError('unhandled_rejection', reason.message || 'promise_rejection', reason.stack || '');
    } else {
      appendError('unhandled_rejection', String(reason || 'promise_rejection'), '');
    }
  });

  function rowHtml(label, value, className) {
    var safeClass = className ? ' class="' + className + '"' : '';
    return '<tr><th>' + label + '</th><td' + safeClass + '>' + value + '</td></tr>';
  }

  function setTableRows(id, rows) {
    var node = document.getElementById(id);
    if (!node) return;
    node.innerHTML = rows.join('');
  }

  function toBoolStatus(value) {
    return value ? '<span class="ok">si</span>' : '<span class="err">no</span>';
  }

  function readStorageSupport(storageName) {
    try {
      var storage = storageName === 'localStorage' ? window.localStorage : window.sessionStorage;
      var key = '__codexweb_diag_' + storageName + '__';
      storage.setItem(key, '1');
      storage.removeItem(key);
      return { ok: true, detail: 'ok' };
    } catch (error) {
      return { ok: false, detail: compactText(error && error.message ? error.message : 'blocked', 180) };
    }
  }

  function checkAsyncAwaitSupport() {
    try {
      var fn = Function('return (async function(){return 1;})');
      return Boolean(fn());
    } catch (_error) {
      return false;
    }
  }

  function checkModuleSupport() {
    var probe = document.createElement('script');
    return 'noModule' in probe;
  }

  function checkCookieSupport() {
    try {
      var key = '__codexweb_diag_cookie__=' + Date.now();
      document.cookie = key + ';path=/;max-age=60;samesite=lax';
      return document.cookie.indexOf('__codexweb_diag_cookie__=') >= 0;
    } catch (_error) {
      return Boolean(navigator && navigator.cookieEnabled);
    }
  }

  function renderEnv() {
    var rows = [];
    rows.push(rowHtml('User-Agent', '<span class="mono">' + compactText(navigator.userAgent, 500) + '</span>'));
    rows.push(rowHtml('Plataforma', compactText(navigator.platform, 120)));
    rows.push(rowHtml('Idioma', compactText(navigator.language, 80)));
    rows.push(rowHtml('Hora local', compactText(new Date().toString(), 200)));
    rows.push(rowHtml('URL', '<span class="mono">' + compactText(window.location.href, 400) + '</span>'));
    rows.push(rowHtml('Cookies activas', toBoolStatus(checkCookieSupport())));
    setTableRows('envRows', rows);
  }

  function renderFeatures() {
    var localStorageStatus = readStorageSupport('localStorage');
    var sessionStorageStatus = readStorageSupport('sessionStorage');
    var rows = [];
    rows.push(rowHtml('ES modules', toBoolStatus(checkModuleSupport())));
    rows.push(rowHtml('fetch', toBoolStatus(typeof window.fetch === 'function')));
    rows.push(rowHtml('Promise', toBoolStatus(typeof window.Promise === 'function')));
    rows.push(rowHtml('async/await', toBoolStatus(checkAsyncAwaitSupport())));
    rows.push(
      rowHtml(
        'localStorage',
        toBoolStatus(localStorageStatus.ok) + (localStorageStatus.ok ? '' : ' · ' + compactText(localStorageStatus.detail, 100))
      )
    );
    rows.push(
      rowHtml(
        'sessionStorage',
        toBoolStatus(sessionStorageStatus.ok) +
          (sessionStorageStatus.ok ? '' : ' · ' + compactText(sessionStorageStatus.detail, 100))
      )
    );
    rows.push(rowHtml('IndexedDB', toBoolStatus(typeof window.indexedDB !== 'undefined')));
    rows.push(rowHtml('WebSocket', toBoolStatus(typeof window.WebSocket === 'function')));
    rows.push(rowHtml('EventSource', toBoolStatus(typeof window.EventSource === 'function')));
    setTableRows('featureRows', rows);
  }

  function httpJson(method, url, body, callback) {
    var done = false;
    function finish(err, result, status, headers) {
      if (done) return;
      done = true;
      callback(err, result, status, headers || {});
    }

    if (typeof window.fetch === 'function') {
      var req = {
        method: method,
        headers: {
          Accept: 'application/json, text/plain, */*'
        },
        credentials: 'same-origin',
        cache: 'no-store'
      };
      if (body) {
        req.headers['Content-Type'] = 'application/json';
        req.body = JSON.stringify(body);
      }
      window
        .fetch(url, req)
        .then(function (response) {
          var headers = {
            contentType: response.headers.get('content-type') || '',
            cacheControl: response.headers.get('cache-control') || ''
          };
          return response
            .text()
            .then(function (text) {
              var parsed = null;
              try {
                parsed = text ? JSON.parse(text) : null;
              } catch (_error) {
                parsed = null;
              }
              finish(null, { text: text, json: parsed }, response.status, headers);
            })
            .catch(function () {
              finish(null, { text: '', json: null }, response.status, headers);
            });
        })
        .catch(function (error) {
          finish(error, null, 0, {});
        });
      return;
    }

    try {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Accept', 'application/json, text/plain, */*');
      if (body) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
      xhr.onreadystatechange = function onXhrReady() {
        if (xhr.readyState !== 4) return;
        var parsed = null;
        try {
          parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch (_error) {
          parsed = null;
        }
        finish(null, { text: xhr.responseText || '', json: parsed }, xhr.status, {
          contentType: xhr.getResponseHeader('content-type') || '',
          cacheControl: xhr.getResponseHeader('cache-control') || ''
        });
      };
      xhr.onerror = function onXhrError() {
        finish(new Error('xhr_error'), null, 0, {});
      };
      xhr.send(body ? JSON.stringify(body) : null);
    } catch (error) {
      finish(error, null, 0, {});
    }
  }

  function fetchText(url, callback) {
    if (typeof window.fetch === 'function') {
      window
        .fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
        .then(function (response) {
          return response
            .text()
            .then(function (text) {
              callback(null, { status: response.status, text: text, contentType: response.headers.get('content-type') || '' });
            })
            .catch(function (error) {
              callback(error, null);
            });
        })
        .catch(function (error) {
          callback(error, null);
        });
      return;
    }

    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function onReady() {
        if (xhr.readyState !== 4) return;
        callback(null, {
          status: xhr.status,
          text: xhr.responseText || '',
          contentType: xhr.getResponseHeader('content-type') || ''
        });
      };
      xhr.onerror = function () {
        callback(new Error('xhr_error'), null);
      };
      xhr.send();
    } catch (error) {
      callback(error, null);
    }
  }

  function setNetworkResult(key, result) {
    state.network[key] = result;
    renderNetworkRows();
    renderPayloadPreview();
  }

  function testEndpoint(label, url, parserName) {
    var startedAt = Date.now();
    httpJson('GET', url + (url.indexOf('?') >= 0 ? '&' : '?') + 'diag=' + Date.now(), null, function (err, result, status, headers) {
      if (err) {
        setNetworkResult(label, {
          ok: false,
          status: 0,
          durationMs: Date.now() - startedAt,
          detail: compactText(err.message || 'request_failed', 220)
        });
        return;
      }
      var detailText = '';
      if (parserName === 'json') {
        detailText = compactText(JSON.stringify(result && result.json ? result.json : null), 280);
      } else {
        detailText = compactText(result && result.text ? result.text : '', 280);
      }
      setNetworkResult(label, {
        ok: status >= 200 && status < 300,
        status: status,
        durationMs: Date.now() - startedAt,
        contentType: headers.contentType || '',
        cacheControl: headers.cacheControl || '',
        detail: detailText
      });
      if (label === 'GET /health') {
        state.health = result && result.json ? result.json : null;
      }
      if (label === 'GET /api/version') {
        state.version = result && result.json ? result.json : null;
      }
    });
  }

  function extractMainAssetsFromIndex(htmlText) {
    var html = String(htmlText || '');
    var scriptMatch = html.match(/<script[^>]+src=["']([^"']*\/assets\/index-[^"']+\.js[^"']*)["']/i);
    var cssMatch = html.match(/<link[^>]+href=["']([^"']*\/assets\/index-[^"']+\.css[^"']*)["']/i);
    return {
      scriptSrc: scriptMatch ? scriptMatch[1] : '',
      cssHref: cssMatch ? cssMatch[1] : ''
    };
  }

  function testAsset(url, label) {
    if (!url) {
      setNetworkResult(label, {
        ok: false,
        status: 0,
        durationMs: 0,
        detail: 'asset_url_missing'
      });
      return;
    }
    var startedAt = Date.now();
    fetchText(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'diag=' + Date.now(), function (err, result) {
      if (err) {
        setNetworkResult(label, {
          ok: false,
          status: 0,
          durationMs: Date.now() - startedAt,
          detail: compactText(err.message || 'asset_fetch_failed', 220)
        });
        return;
      }
      var bodySample = compactText(result && result.text ? result.text.slice(0, 180) : '', 220);
      setNetworkResult(label, {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        durationMs: Date.now() - startedAt,
        contentType: result.contentType || '',
        detail: bodySample
      });
    });
  }

  function renderNetworkRows() {
    var rows = [];
    var keys = Object.keys(state.network || {});
    if (keys.length === 0) {
      rows.push(rowHtml('Estado', 'Cargando pruebas de red...'));
      setTableRows('networkRows', rows);
      return;
    }
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      var item = state.network[key] || {};
      var statusClass = item.ok ? 'ok' : 'err';
      var statusText = (item.ok ? 'OK' : 'FAIL') + ' · HTTP ' + String(item.status || 0) + ' · ' + String(item.durationMs || 0) + 'ms';
      var info = [
        item.contentType ? 'type=' + item.contentType : '',
        item.cacheControl ? 'cache=' + item.cacheControl : '',
        item.detail ? 'detalle=' + item.detail : ''
      ]
        .filter(Boolean)
        .join(' · ');
      rows.push(rowHtml(key, '<span class="' + statusClass + '">' + statusText + '</span><br><span class="mono">' + compactText(info, 500) + '</span>'));
    }
    setTableRows('networkRows', rows);
  }

  function renderErrorLog() {
    var node = document.getElementById('errorLog');
    if (!node) return;
    if (!state.errors || state.errors.length === 0) {
      node.textContent = '(sin errores capturados en esta pagina)';
      return;
    }
    node.textContent = state.errors
      .map(function (entry) {
        return (
          '[' +
          String(entry.at || '') +
          '] ' +
          compactText(entry.kind, 40) +
          ': ' +
          compactText(entry.message, 220) +
          (entry.detail ? ' · ' + compactText(entry.detail, 300) : '')
        );
      })
      .join('\n');
  }

  function buildPayload() {
    var localStorageStatus = readStorageSupport('localStorage');
    var sessionStorageStatus = readStorageSupport('sessionStorage');
    var payload = {
      source: 'diag_page',
      timestamp: new Date().toISOString(),
      url: String(window.location.href || ''),
      userAgent: String(navigator.userAgent || ''),
      platform: String(navigator.platform || ''),
      language: String(navigator.language || ''),
      featureChecks: {
        esModules: checkModuleSupport(),
        fetch: typeof window.fetch === 'function',
        promise: typeof window.Promise === 'function',
        asyncAwait: checkAsyncAwaitSupport(),
        localStorage: localStorageStatus.ok,
        sessionStorage: sessionStorageStatus.ok,
        indexedDB: typeof window.indexedDB !== 'undefined',
        webSocket: typeof window.WebSocket === 'function',
        eventSource: typeof window.EventSource === 'function',
        cookiesEnabled: checkCookieSupport()
      },
      storage: {
        localStorage: localStorageStatus,
        sessionStorage: sessionStorageStatus,
        cookieEnabled: checkCookieSupport()
      },
      healthcheck: state.health,
      version: state.version,
      assets: {
        mainScript: state.mainScript,
        mainCss: state.mainCss
      },
      networkChecks: state.network,
      errors: state.errors,
      referrer: String(document.referrer || '')
    };
    return payload;
  }

  function renderPayloadPreview() {
    var node = document.getElementById('payloadPreview');
    if (!node) return;
    node.textContent = JSON.stringify(buildPayload(), null, 2);
  }

  function sendDiagnostic() {
    var payload = buildPayload();
    var button = document.getElementById('btnSend');
    if (button) {
      button.textContent = 'Enviando...';
      button.setAttribute('disabled', 'disabled');
    }
    httpJson('POST', '/api/frontend/diag-report', payload, function (err, result, status) {
      if (button) {
        button.removeAttribute('disabled');
      }
      if (err || status < 200 || status >= 300) {
        appendError('diag_report', 'No se pudo enviar diagnostico', (err && err.message) || 'status=' + String(status || 0));
        if (button) button.textContent = 'Reintentar envio';
        return;
      }
      if (button) button.textContent = 'Diagnostico enviado';
      renderPayloadPreview();
    });
  }

  function clearCacheAndReload() {
    var button = document.getElementById('btnClear');
    if (button) {
      button.textContent = 'Limpiando...';
      button.setAttribute('disabled', 'disabled');
    }

    function reloadNow() {
      var nextUrl = '/diag?reload=' + Date.now();
      try {
        window.location.replace(nextUrl);
      } catch (_error) {
        window.location.href = nextUrl;
      }
    }

    var tasks = [];
    try {
      window.localStorage.clear();
    } catch (_error) {
      // ignore
    }
    try {
      window.sessionStorage.clear();
    } catch (_error) {
      // ignore
    }

    if (navigator && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === 'function') {
      tasks.push(
        navigator.serviceWorker
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
          })
      );
    }

    if (window.caches && typeof window.caches.keys === 'function') {
      tasks.push(
        window.caches
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
          })
      );
    }

    if (tasks.length === 0) {
      reloadNow();
      return;
    }

    Promise.all(
      tasks.map(function (entry) {
        return Promise.resolve(entry).catch(function () {
          return null;
        });
      })
    )
      .then(function () {
        reloadNow();
      })
      .catch(function () {
        reloadNow();
      });
  }

  function bindButtons() {
    var sendButton = document.getElementById('btnSend');
    var clearButton = document.getElementById('btnClear');
    var startButton = document.getElementById('btnStart');

    if (sendButton) {
      sendButton.addEventListener('click', function onSendClick() {
        sendDiagnostic();
      });
    }

    if (clearButton) {
      clearButton.addEventListener('click', function onClearClick() {
        clearCacheAndReload();
      });
    }

    if (startButton) {
      startButton.setAttribute('href', '/?debug=1&safe=1&reload=' + Date.now());
    }
  }

  function runNetworkChecks() {
    setNetworkResult('GET /health', { ok: false, status: 0, durationMs: 0, detail: 'pending' });
    setNetworkResult('GET /api/version', { ok: false, status: 0, durationMs: 0, detail: 'pending' });
    setNetworkResult('GET / (index)', { ok: false, status: 0, durationMs: 0, detail: 'pending' });

    testEndpoint('GET /health', '/health', 'json');
    testEndpoint('GET /api/version', '/api/version', 'json');

    var startedAt = Date.now();
    fetchText('/?diag=' + Date.now(), function onIndex(err, result) {
      if (err) {
        setNetworkResult('GET / (index)', {
          ok: false,
          status: 0,
          durationMs: Date.now() - startedAt,
          detail: compactText(err && err.message ? err.message : 'index_fetch_failed', 220)
        });
        renderPayloadPreview();
        return;
      }
      setNetworkResult('GET / (index)', {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        durationMs: Date.now() - startedAt,
        contentType: result.contentType || '',
        detail: compactText(result.text.slice(0, 220), 220)
      });

      var assets = extractMainAssetsFromIndex(result.text || '');
      state.mainScript = assets.scriptSrc;
      state.mainCss = assets.cssHref;
      testAsset(assets.scriptSrc, 'GET main JS');
      testAsset(assets.cssHref, 'GET main CSS');
      renderPayloadPreview();
    });
  }

  renderEnv();
  renderFeatures();
  renderErrorLog();
  bindButtons();
  runNetworkChecks();
  renderPayloadPreview();
})();
