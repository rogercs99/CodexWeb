const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.toString()));
  page.on('console', m => {
    if (m.type() === 'error') console.log('CONSOLE_ERROR', m.text());
  });
  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].map((b, i) => ({
      i,
      text: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      cls: b.className,
      aria: b.getAttribute('aria-label') || '',
      title: b.getAttribute('title') || ''
    }));
    const links = [...document.querySelectorAll('a')].slice(0, 40).map((a, i) => ({
      i,
      text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      href: a.getAttribute('href') || '',
      cls: a.className,
    }));
    return {
      title: document.title,
      url: location.href,
      textSample: (document.body.innerText || '').slice(0, 1200),
      buttonCount: buttons.length,
      buttons,
      links
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path: '/tmp/stremio-home-mobile.png', fullPage: true });
  console.log('screenshot:/tmp/stremio-home-mobile.png');
  await browser.close();
})();
