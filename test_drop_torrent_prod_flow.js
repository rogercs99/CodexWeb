const { chromium, devices } = require('playwright');

const TORRENT_URL = 'https://webtorrent.io/torrents/sintel.torrent';

(async () => {
  const buf = Buffer.from(await (await fetch(TORRENT_URL)).arrayBuffer()).toString('base64');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const requests = [];
  const responses = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', req => {
    if (req.url().includes('/stremio-server/') && req.url().includes('/create')) {
      requests.push({ method: req.method(), url: req.url(), postDataLen: (req.postData() || '').length });
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes('/stremio-server/') && res.url().includes('/create')) {
      let txt = '';
      try { txt = (await res.text()).slice(0, 200); } catch (_) {}
      responses.push({ status: res.status(), url: res.url(), text: txt.replace(/\s+/g, ' ') });
    }
  });

  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1400);

  await page.evaluate(({ b64 }) => {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const file = new File([bytes], 'sintel.torrent', { type: 'application/x-bittorrent' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64: buf });

  await page.waitForTimeout(15000);

  const ui = await page.evaluate(() => ({
    href: location.href,
    hash: location.hash,
    hasDescargar: (document.body.innerText || '').includes('Descargar'),
    hasSintel: (document.body.innerText || '').includes('Sintel'),
    sample: (document.body.innerText || '').slice(0, 900)
  }));

  console.log(JSON.stringify({ requests, responses, errorsCount: errors.length, firstError: errors[0] || null, ui }, null, 2));
  await browser.close();
})();
