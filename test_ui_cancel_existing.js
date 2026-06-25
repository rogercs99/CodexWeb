const { chromium, devices } = require('playwright');

const SOURCE_URL = 'https://stremio.gamemodai.pro/stremio-server/08ada5a7a6183aae1e09d831df6748d566095a10/5?';

async function createSession(label) {
  const res = await fetch('https://stremio.gamemodai.pro/api/downloads/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceUrl: SOURCE_URL, fileName: `${label}.mp4`, title: label }),
  });
  const text = await res.text();
  const json = JSON.parse(text);
  if (!res.ok || !json?.session?.id) {
    throw new Error(`start failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return json.session.id;
}

async function run(mobile) {
  const label = `UI Cancel ${Date.now()} ${mobile ? 'M' : 'D'}`;
  const sessionId = await createSession(label);

  const browser = await chromium.launch({ headless: true });
  const context = mobile
    ? await browser.newContext({ ...devices['iPhone 13'] })
    : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const reqs = [];
  const errors = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/downloads/')) reqs.push(`${r.method()} ${r.url()}`);
  });
  page.on('pageerror', (e) => errors.push(String(e && e.stack || e)));

  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(900);

  let mis = page.getByText('Mis descargas', { exact: false });
  if (!(await mis.count())) {
    const menu = page.locator('[class*="menu-button"], [aria-label*="menu" i], [title*="menu" i]').first();
    if (await menu.count()) {
      await menu.click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(350);
    }
    mis = page.getByText('Mis descargas', { exact: false });
  }

  if (await mis.count()) {
    await mis.first().click({ timeout: 10000 }).catch(() => {});
  }

  await page.waitForTimeout(1800);

  const hasLabel = await page.getByText(label, { exact: false }).count();
  const cancelButton = page.getByText('Cancelar', { exact: false }).first();
  let cancelClicked = false;
  if (await cancelButton.count()) {
    await cancelButton.click({ timeout: 8000 }).catch(() => {});
    cancelClicked = true;
  }

  await page.waitForTimeout(2200);

  const after = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      hasCanceledText: /Cancelado|canceled/i.test(txt),
      stillActive: /En cola|Iniciando descarga|Descargando/i.test(txt),
      snippet: txt.slice(0, 2200),
    };
  });

  const p = await fetch(`https://stremio.gamemodai.pro/api/downloads/${sessionId}/progress`);
  const pjson = await p.json();

  console.log(JSON.stringify({
    mobile,
    label,
    sessionId,
    hasLabel: hasLabel > 0,
    cancelClicked,
    apiStatusAfter: pjson?.session?.status || null,
    apiDownloadedBytesAfter: pjson?.session?.downloadedBytes || null,
    pageErrorCount: errors.length,
    firstPageError: errors[0] || null,
    after,
    apiReqs: reqs.filter((x) => x.includes('/cancel') || x.includes('/progress') || x.includes('/sessions')).slice(-20),
  }, null, 2));

  await browser.close();
}

(async () => {
  await run(false);
  await run(true);
})();
