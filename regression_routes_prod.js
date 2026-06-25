const { chromium, devices } = require('playwright');

async function run(mobile) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile ? await browser.newContext({ ...devices['iPhone 13'] }) : await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  const routes = ['#/', '#/discover', '#/library', '#/calendar', '#/addons', '#/settings', '#/search'];
  const results = [];
  for (const hash of routes) {
    await page.goto(`https://stremio.gamemodai.pro/${hash}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
    const info = await page.evaluate(() => {
      const app = document.querySelector('#app');
      return { childCount: app ? app.children.length : -1, htmlLen: app ? app.innerHTML.length : -1, hash: location.hash };
    });
    results.push({ hash, ...info });
  }

  console.log(JSON.stringify({ mobile, pageErrorCount: errs.length, firstError: errs[0] || null, results }, null, 2));
  await browser.close();
}

(async()=>{ await run(false); await run(true); })();
