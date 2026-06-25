const { chromium, devices } = require('playwright');

async function run(mobile) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile ? await browser.newContext({ ...devices['iPhone 13'] }) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push(String(e)));

  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);

  const tabs = ['Discover','Library','Calendar','Addons','Settings','Board'];
  const results=[];
  for (const tab of tabs) {
    const el = page.getByText(tab, { exact: true }).first();
    if (await el.count()) {
      await el.click({ timeout: 8000 }).catch(()=>{});
      await page.waitForTimeout(700);
      const appInfo = await page.evaluate(() => {
        const app = document.querySelector('#app');
        return { childCount: app ? app.children.length : -1, textLen: app ? app.textContent.length : -1, hash: location.hash };
      });
      results.push({ tab, ...appInfo });
    }
  }

  console.log(JSON.stringify({ mobile, pageErrorCount: errs.length, firstError: errs[0] || null, results }, null, 2));
  await browser.close();
}

(async()=>{ await run(false); await run(true); })();
