const { chromium, devices } = require('playwright');

async function run(mobile) {
  const browser = await chromium.launch({ headless: true });
  const context = mobile ? await browser.newContext({ ...devices['iPhone 13'] }) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:11475/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1800);

  const mis = page.getByText('Mis descargas', { exact: false });
  if (await mis.count() === 0) {
    const menu = page.locator('[class*="menu-button"], [aria-label*="menu" i], [title*="menu" i]').first();
    if (await menu.count()) {
      await menu.click({ timeout: 10000 }).catch(()=>{});
      await page.waitForTimeout(400);
    }
  }
  const m2 = page.getByText('Mis descargas', { exact: false });
  if (await m2.count()) {
    await m2.first().click({ timeout: 10000 });
    await page.waitForTimeout(1200);
  }

  const state = await page.evaluate(() => {
    const text = document.body.innerText || '';
    const hasMp4 = text.includes('Sintel-08f5fc56e9.mp4') || text.includes('Sintel.mp4');
    const hasSrt = text.includes('Sintel-c9d9fba069.srt') || text.includes('Sintel.de.srt');
    const completedCount = (text.match(/Completado/g) || []).length;
    const saveCount = (text.match(/Guardar/g) || []).length;
    const removeCount = (text.match(/Quitar/g) || []).length;
    const deleteServerCount = (text.match(/Eliminar servidor/g) || []).length;
    return {
      hasMp4,
      hasSrt,
      completedCount,
      saveCount,
      removeCount,
      deleteServerCount,
      textSample: text.slice(0, 1500),
      appChildren: document.querySelector('#app')?.children.length ?? -1,
    };
  });

  console.log(JSON.stringify({ mobile, pageErrorCount: errors.length, firstError: errors[0] || null, state }, null, 2));
  await browser.close();
}

(async () => {
  await run(false);
  await run(true);
})();
