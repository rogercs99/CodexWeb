const { chromium, webkit, devices } = require('playwright');

async function run(name, browserType) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  page.on('pageerror', err => errors.push(String(err && err.stack || err)));
  page.on('console', msg => {
    if (msg.type() === 'error') logs.push(msg.text());
  });
  try {
    await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    const menuButton = page.getByRole('button').first();
    await menuButton.click({ timeout: 10000 });
    await page.waitForTimeout(700);

    const target = page.getByText('Mis descargas', { exact: false });
    await target.click({ timeout: 10000 });
    await page.waitForTimeout(2000);

    const appInfo = await page.evaluate(() => {
      const app = document.querySelector('#app');
      return {
        childCount: app ? app.children.length : -1,
        textLen: app ? app.textContent.trim().length : -1,
        htmlLen: app ? app.innerHTML.length : -1
      };
    });

    console.log(JSON.stringify({
      browser: name,
      ok: true,
      appInfo,
      errorCount: errors.length,
      consoleErrorCount: logs.length,
      firstError: errors[0] || null,
      firstConsoleError: logs[0] || null,
    }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ browser: name, ok: false, exception: String(e), firstError: errors[0] || null }, null, 2));
  } finally {
    await browser.close();
  }
}

(async () => {
  for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
    try {
      await run(name, type);
    } catch (e) {
      console.log(JSON.stringify({ browser: name, ok: false, launchError: String(e) }, null, 2));
    }
  }
})();
