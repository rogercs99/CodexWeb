const { chromium } = require('playwright');

const TORRENT_URL = 'https://webtorrent.io/torrents/sintel.torrent';

(async () => {
  const b64 = Buffer.from(await (await fetch(TORRENT_URL)).arrayBuffer()).toString('base64');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));

  await page.goto('https://stremio.gamemodai.pro/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);

  await page.evaluate(({ b64 }) => {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    const file = new File([bytes], 'sintel.torrent', { type: 'application/x-bittorrent' });
    const dt = new DataTransfer();
    dt.items.add(file);
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64 });

  await page.waitForURL(/#\/detail\/other\/bt%3A/i, { timeout: 60000 });
  await page.waitForTimeout(1000);

  const videoItem = page.getByText('Sintel.mp4', { exact: false }).first();
  if (await videoItem.count()) {
    await videoItem.click({ timeout: 15000 });
  }

  await page.waitForTimeout(2000);

  // click quick-download action if visible
  const quickDownload = page.getByText('Descargar', { exact: false }).first();
  if (await quickDownload.count()) {
    await quickDownload.click({ timeout: 15000 });
  }

  await page.waitForTimeout(2000);

  // open menu and downloads panel
  const menu = page.locator('[class*="menu-button"], [aria-label*="menu" i], [title*="menu" i]').first();
  if (await menu.count()) {
    await menu.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  const mis = page.getByText('Mis descargas', { exact: false });
  if (await mis.count()) {
    await mis.first().click({ timeout: 10000 });
    await page.waitForTimeout(1200);
  }

  const state = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      href: location.href,
      hash: location.hash,
      hasDownloadsPanel: txt.includes('Mis descargas'),
      hasSintel: txt.includes('Sintel'),
      hasProgressPercent: /\d+\.\d+%/.test(txt),
      hasStatusDownloading: txt.includes('Descargando'),
      hasStatusCompleted: txt.includes('Completado'),
      hasGuardar: txt.includes('Guardar'),
      sample: txt.slice(0, 1800)
    };
  });

  console.log(JSON.stringify({ errors: errs.slice(0,2), state }, null, 2));
  await browser.close();
})();
