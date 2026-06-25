const { chromium } = require('playwright');

const MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&tr=wss%3A%2F%2Ftracker.fastcast.nz&ws=https%3A%2F%2Fwebtorrent.io%2Ftorrents%2F';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  const reqs = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/stremio-server/') || u.includes('11472')) reqs.push(`${r.method()} ${u}`);
  });

  await page.goto('http://127.0.0.1:11475/#/search', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1200);
  const input = page.locator('input').first();
  await input.fill(MAGNET);

  await page.waitForTimeout(40000);

  const data = await page.evaluate(() => ({
    url: location.href,
    hash: location.hash,
    hasDownloadWord: document.body.innerText.includes('Descargar'),
    downloadCount: (document.body.innerText.match(/Descargar/g) || []).length,
    hasLongMetadataToast: document.body.innerText.includes('taking a long time to get metadata'),
    textSample: (document.body.innerText || '').slice(0, 1200)
  }));

  console.log(JSON.stringify({ ok: true, data, pageErrorCount: pageErrors.length, firstPageError: pageErrors[0] || null, reqs: reqs.slice(-120) }, null, 2));
  await browser.close();
})();
