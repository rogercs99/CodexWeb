const { chromium } = require('playwright');

const TORRENT_URL = 'https://webtorrent.io/torrents/sintel.torrent';

(async () => {
  const torrentResp = await fetch(TORRENT_URL);
  const b64 = Buffer.from(await torrentResp.arrayBuffer()).toString('base64');

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const reqs = [];
  const resps = [];

  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/stremio-server/')) {
      reqs.push({ t: Date.now(), method: req.method(), url: u, postDataLen: (req.postData() || '').length });
    }
  });

  page.on('response', async (resp) => {
    const u = resp.url();
    if (u.includes('/stremio-server/')) {
      let txt = '';
      try {
        txt = (await resp.text()).slice(0, 180);
      } catch (_) {}
      resps.push({ t: Date.now(), status: resp.status(), url: u, text: txt.replace(/\s+/g, ' ') });
    }
  });

  await page.goto('http://127.0.0.1:11475/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1300);

  await page.evaluate(({ b64 }) => {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const file = new File([bytes], 'sintel.torrent', { type: 'application/x-bittorrent' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64 });

  await page.waitForTimeout(25000);

  console.log(JSON.stringify({ reqs, resps, hash: await page.evaluate(() => location.hash), href: await page.evaluate(()=>location.href) }, null, 2));
  await browser.close();
})();
