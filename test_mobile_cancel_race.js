const { chromium, devices } = require('playwright');
const SOURCE_URL = 'https://stremio.gamemodai.pro/stremio-server/08ada5a7a6183aae1e09d831df6748d566095a10/5?';

(async () => {
  const label = `Race UI ${Date.now()}`;
  const startRes = await fetch('https://stremio.gamemodai.pro/api/downloads/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceUrl: SOURCE_URL, fileName: `${label}.mp4`, title: label }),
  });
  const start = await startRes.json();
  const id = start?.session?.id;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e)));

  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  let mis = page.getByText('Mis descargas', { exact: false });
  if (!(await mis.count())) {
    const menu = page.locator('[class*="menu-button"], [aria-label*="menu" i], [title*="menu" i]').first();
    if (await menu.count()) { await menu.click().catch(() => {}); await page.waitForTimeout(400); }
    mis = page.getByText('Mis descargas', { exact: false });
  }
  if (await mis.count()) await mis.first().click().catch(() => {});

  await page.waitForTimeout(1800);
  const cancelBtn = page.getByText('Cancelar', { exact: false }).first();
  let clicked = false;
  if (await cancelBtn.count()) {
    await cancelBtn.click().catch(() => {});
    clicked = true;
  }
  await page.waitForTimeout(2500);

  const txt = await page.evaluate(() => document.body.innerText || '');
  const p = await fetch(`https://stremio.gamemodai.pro/api/downloads/${id}/progress`).then(r => r.json());
  console.log(JSON.stringify({
    id,
    clicked,
    hasCompletedErrorText: txt.includes('This download is already completed'),
    hasDescargaFallida: txt.includes('Descarga fallida'),
    hasLabel: txt.includes(label),
    apiStatus: p?.session?.status,
    apiErrorCode: p?.session?.errorCode || null,
    snippet: txt.slice(0, 1800),
  }, null, 2));

  await browser.close();
})();
