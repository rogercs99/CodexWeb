const { chromium } = require('playwright');
const TORRENT_URL = 'https://webtorrent.io/torrents/sintel.torrent';
(async () => {
  const b64 = Buffer.from(await (await fetch(TORRENT_URL)).arrayBuffer()).toString('base64');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.on('request', req => {
    if (req.url().includes('/api/downloads/')) console.log('REQ', req.method(), req.url());
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('/api/downloads/')) {
      let txt = '';
      try { txt = await res.text(); } catch {}
      console.log('RES', res.status(), u, txt.slice(0,200));
    }
  });
  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.evaluate(({ b64 }) => {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i=0;i<raw.length;i++) bytes[i] = raw.charCodeAt(i);
    const file = new File([bytes], 'sintel.torrent', { type: 'application/x-bittorrent' });
    const dt = new DataTransfer(); dt.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64 });
  await page.waitForTimeout(5000);

  const data = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('button,[role="button"],a')]
      .map((el) => ({
        tag: el.tagName,
        text: (el.innerText || '').trim().replace(/\s+/g,' '),
        aria: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        cls: el.className || '',
      }))
      .filter((x) => x.text || x.aria || x.title)
      .slice(0, 200);
    return { href: location.href, hash: location.hash, nodes, body: (document.body.innerText || '').slice(0,2500) };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
