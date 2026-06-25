const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  let errors = 0;
  page.on('pageerror', () => { errors += 1; });

  const rounds = [];
  for (let i=1; i<=4; i++) {
    await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(900);
    const app = await page.evaluate(() => ({
      childCount: document.querySelector('#app')?.children.length ?? -1,
      hash: location.hash
    }));

    const menu = page.locator('[class*="menu-button"], [aria-label*="menu" i], [title*="menu" i]').first();
    if (await menu.count()) {
      await menu.click({ timeout: 10000 }).catch(()=>{});
      await page.waitForTimeout(300);
    }
    const mis = page.getByText('Mis descargas', { exact: false });
    if (await mis.count()) {
      await mis.first().click({ timeout: 10000 });
      await page.waitForTimeout(600);
    }

    const panel = await page.evaluate(() => {
      const txt = document.body.innerText || '';
      return {
        hasCompleted: txt.includes('Completado'),
        hasSintel: txt.includes('Sintel-08f5fc56e9.mp4'),
      };
    });
    rounds.push({ i, ...app, ...panel });
  }

  console.log(JSON.stringify({ errors, rounds }, null, 2));
  await browser.close();
})();
