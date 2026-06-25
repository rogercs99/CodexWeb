const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => { errors.push(String(e)); console.log('PAGEERROR', String(e)); });
  page.on('console', m => { if (m.type()==='error') console.log('CONSOLE_ERROR', m.text()); });
  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  const menuCandidates = await page.locator('button,[role="button"],a').allTextContents();
  console.log('allTextSample', menuCandidates.filter(Boolean).map(t=>t.trim()).filter(Boolean).slice(0,60));

  // Try open nav menu icon by class.
  const menuBtn = page.locator('[class*="menu-button"],[aria-label*="menu" i]').first();
  if (await menuBtn.count()) {
    await menuBtn.click({ timeout: 10000 }).catch(()=>{});
  }
  await page.waitForTimeout(500);

  const mis = page.getByText('Mis descargas', { exact: false });
  const count = await mis.count();
  console.log('misCount', count);
  if (count > 0) {
    await mis.first().click({ timeout: 10000 });
    await page.waitForTimeout(2000);
  }

  const appInfo = await page.evaluate(() => {
    const app = document.querySelector('#app');
    return {
      childCount: app ? app.children.length : -1,
      htmlLen: app ? app.innerHTML.length : -1,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      hasMisText: document.body.innerText.includes('Mis descargas'),
    };
  });
  console.log('APP', JSON.stringify(appInfo));
  console.log('ERRORS', errors.length);
  await page.screenshot({ path: '/tmp/stremio-desktop-after-mis.png', fullPage: true });
  console.log('screenshot:/tmp/stremio-desktop-after-mis.png');
  await browser.close();
})();
