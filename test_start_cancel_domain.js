const { chromium } = require('playwright');
const TORRENT_URL = 'https://webtorrent.io/torrents/sintel.torrent';

(async () => {
  const b64 = Buffer.from(await (await fetch(TORRENT_URL)).arrayBuffer()).toString('base64');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const reqs = [];
  const ress = [];
  page.on('request', r => { if (r.url().includes('/api/downloads') || r.url().includes('/stremio-server/')) reqs.push(`${r.method()} ${r.url()}`); });
  page.on('response', async r => {
    const u = r.url();
    if (u.includes('/api/downloads') || u.includes('/stremio-server/')) {
      let txt='';
      try { txt = await r.text(); } catch {}
      ress.push(`${r.status()} ${u} ${txt.slice(0,120)}`);
    }
  });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.stack || e)));

  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(1200);

  await page.evaluate(({ b64 }) => {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const file = new File([bytes], 'sintel.torrent', { type: 'application/x-bittorrent' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64 });

  await page.waitForURL(/#\/detail\/other\/bt%3A/i, { timeout: 60000 });
  await page.waitForTimeout(2000);

  const sintelFile = page.getByText('Sintel.mp4', { exact: false }).first();
  if (await sintelFile.count()) {
    await sintelFile.click({ timeout: 15000 }).catch(() => {});
  }

  await page.waitForTimeout(4000);

  // Try all buttons that look like download actions
  const candidates = [
    page.getByText(/Descargar|Download|Guardar/i),
    page.locator('button:has([data-icon*="download" i])'),
    page.locator('[title*="download" i], [aria-label*="download" i], [title*="descarg" i], [aria-label*="descarg" i]'),
  ];
  let clickedAction = null;
  for (const c of candidates) {
    const n = await c.count();
    if (n > 0) {
      try {
        await c.first().click({ timeout: 5000 });
        clickedAction = await c.first().innerText().catch(() => 'icon-action');
        break;
      } catch (_) {}
    }
  }

  await page.waitForTimeout(3000);

  // Open downloads panel
  let mis = page.getByText('Mis descargas', { exact: false });
  if (!(await mis.count())) {
    const menu = page.locator('[class*="menu-button"], [aria-label*="menu" i], [title*="menu" i]').first();
    if (await menu.count()) {
      await menu.click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    mis = page.getByText('Mis descargas', { exact: false });
  }
  if (await mis.count()) {
    await mis.first().click({ timeout: 10000 }).catch(() => {});
  }

  await page.waitForTimeout(2500);

  const before = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      url: location.href,
      hasCancelable: /Cancelar/i.test(txt),
      hasActive: /En cola|Iniciando descarga|Descargando/i.test(txt),
      snippet: txt.slice(0, 2500),
    };
  });

  const cancel = page.getByText('Cancelar', { exact: false }).first();
  let cancelClicked = false;
  if (await cancel.count()) {
    await cancel.click({ timeout: 10000 }).catch(() => {});
    cancelClicked = true;
  }

  await page.waitForTimeout(3000);

  const after = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      hasCanceled: /Cancelado|canceled/i.test(txt),
      stillActive: /En cola|Iniciando descarga|Descargando/i.test(txt),
      hasCancelButton: /Cancelar/i.test(txt),
      snippet: txt.slice(0, 2500),
    };
  });

  console.log(JSON.stringify({ clickedAction, before, after, cancelClicked, pageErrorCount: pageErrors.length, firstPageError: pageErrors[0] || null, reqs: reqs.slice(-40), ress: ress.slice(-40) }, null, 2));
  await browser.close();
})();
