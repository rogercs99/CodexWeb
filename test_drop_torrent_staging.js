const { chromium } = require('playwright');

const TORRENT_URL = 'https://webtorrent.io/torrents/sintel.torrent';

(async () => {
  const torrentResp = await fetch(TORRENT_URL, { redirect: 'follow' });
  if (!torrentResp.ok) {
    throw new Error(`Failed downloading test torrent: HTTP ${torrentResp.status}`);
  }
  const torrentBuffer = Buffer.from(await torrentResp.arrayBuffer());
  const b64 = torrentBuffer.toString('base64');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const createReqs = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('request', req => {
    if (req.url().includes('/stremio-server/') && req.url().includes('/create')) {
      createReqs.push({ url: req.url(), method: req.method(), hasBody: Boolean(req.postData()), bodyLen: (req.postData() || '').length });
    }
  });

  await page.goto('http://127.0.0.1:11475/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1200);

  await page.evaluate(async ({ b64 }) => {
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) arr[i] = raw.charCodeAt(i);

    const file = new File([arr], 'sintel.torrent', { type: 'application/x-bittorrent' });
    const dt = new DataTransfer();
    dt.items.add(file);

    const ev = new DragEvent('drop', {
      dataTransfer: dt,
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(ev);
  }, { b64 });

  await page.waitForTimeout(20000);

  const state = await page.evaluate(() => ({
    href: location.href,
    hash: location.hash,
    title: document.title,
    hasDescargar: document.body.innerText.includes('Descargar'),
    hasMisDescargas: document.body.innerText.includes('Mis descargas'),
    textSample: (document.body.innerText || '').slice(0, 1200)
  }));

  console.log(JSON.stringify({ ok: true, state, pageErrorCount: pageErrors.length, firstPageError: pageErrors[0] || null, createReqs }, null, 2));

  await browser.close();
})();
