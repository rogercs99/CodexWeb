const { chromium, devices } = require('playwright');

async function run(url, mobile = false) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile ? await browser.newContext({ ...devices['iPhone 13'] }) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.stack || err)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 70000 });
    await page.waitForTimeout(1200);

    // Open top-right nav menu if present.
    const menuButton = page.locator('[class*="menu-button"], [aria-label*="menu" i], button:has(svg)').first();
    if (await menuButton.count()) {
      await menuButton.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
    }

    const mis = page.getByText('Mis descargas', { exact: false });
    const misCount = await mis.count();
    if (misCount > 0) {
      await mis.first().click({ timeout: 10000 });
      await page.waitForTimeout(1200);
    }

    const state = await page.evaluate(() => {
      const app = document.querySelector('#app');
      const hasDownloadsWord = /Descargas|Mis descargas|No hay descargas/i.test(document.body.innerText || '');
      return {
        url: location.href,
        appChildren: app ? app.children.length : -1,
        appHtmlLen: app ? app.innerHTML.length : -1,
        hasDownloadsWord,
        bodyTextSample: (document.body.innerText || '').slice(0, 220)
      };
    });

    console.log(JSON.stringify({ ok: true, url, mobile, misCount, state, pageErrorCount: pageErrors.length, firstPageError: pageErrors[0] || null, consoleErrorCount: consoleErrors.length, firstConsoleError: consoleErrors[0] || null }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, url, mobile, exception: String(e), pageErrorCount: pageErrors.length, firstPageError: pageErrors[0] || null }, null, 2));
  } finally {
    await browser.close();
  }
}

(async () => {
  const url = process.argv[2] || 'https://stremio.gamemodai.pro/';
  await run(url, false);
  await run(url, true);
})();
