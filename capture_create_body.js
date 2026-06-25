const { chromium } = require('playwright');
const MAGNET = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('request', (req) => {
    if (req.url().includes('/create')) {
      console.log('CREATE_REQ', req.method(), req.url());
      console.log('HEADERS', JSON.stringify(req.headers()));
      const data = req.postData();
      console.log('POSTDATA', data ? data.slice(0,400) : null);
    }
  });
  await page.goto('http://127.0.0.1:11475/#/search', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  const input = page.locator('input').first();
  await input.fill(MAGNET);
  await page.waitForTimeout(3000);
  await browser.close();
})();
