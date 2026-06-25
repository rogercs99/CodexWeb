const { chromium, devices } = require('playwright');

async function run(url, mobile) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile ? await browser.newContext({ ...devices['iPhone 13'] }) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.stack || err)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  let result;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

    const mis = page.getByText('Mis descargas', { exact: false });
    const initialMisCount = await mis.count();

    if (initialMisCount === 0) {
      const menu = page.locator('[class*="menu-button"], [aria-label*="menu" i], [title*="menu" i]').first();
      if (await menu.count()) {
        await menu.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    const target = page.getByText('Mis descargas', { exact: false });
    const misCount = await target.count();
    if (misCount > 0) {
      await target.first().click({ timeout: 10000 });
      await page.waitForTimeout(1800);
    }

    const state = await page.evaluate(() => {
      const app = document.querySelector('#app');
      return {
        appChildren: app ? app.children.length : -1,
        appHtmlLen: app ? app.innerHTML.length : -1,
        hasDownloadsText: /No hay descargas|Descargas|Mis descargas/i.test(document.body.innerText || ''),
        innerTextSample: (document.body.innerText || '').slice(0, 200)
      };
    });

    result = { ok: true, url, mobile, initialMisCount, misCount, state, pageErrorCount: pageErrors.length, firstPageError: pageErrors[0] || null, consoleErrorCount: consoleErrors.length, firstConsoleError: consoleErrors[0] || null };
  } catch (e) {
    result = { ok: false, url, mobile, exception: String(e), pageErrorCount: pageErrors.length, firstPageError: pageErrors[0] || null, consoleErrorCount: consoleErrors.length, firstConsoleError: consoleErrors[0] || null };
  }
  console.log(JSON.stringify(result));
  await browser.close();
}

(async () => {
  const url = process.argv[2];
  await run(url, false);
  await run(url, true);
})();
