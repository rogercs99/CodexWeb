import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3099';
const OUT = path.resolve('artifacts/screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function register() {
  const username = `mobile_${Date.now()}`;
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'audit_password_123' })
  });
  if (![200, 201].includes(res.status)) throw new Error(`register failed ${res.status}: ${await res.text()}`);
  const setCookie = res.headers.get('set-cookie') || '';
  const cookiePair = setCookie.split(';')[0];
  return { username, cookiePair };
}

async function layoutSnapshot(page, label) {
  await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true });
  return await page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const doc = document.documentElement;
    const fixed = [...document.querySelectorAll('*')]
      .map((el) => {
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed') return null;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return null;
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 80),
          left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom),
          width: Math.round(r.width), height: Math.round(r.height), zIndex: style.zIndex
        };
      })
      .filter(Boolean);
    const overlaps = [];
    for (let i = 0; i < fixed.length; i++) {
      for (let j = i + 1; j < fixed.length; j++) {
        const a = fixed[i], b = fixed[j];
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (x * y > 800) overlaps.push({ a: a.text || a.tag, b: b.text || b.tag, area: x * y });
      }
    }
    return {
      url: window.location.href,
      title: document.title,
      viewport,
      scrollWidth: doc.scrollWidth,
      scrollHeight: doc.scrollHeight,
      horizontalOverflow: doc.scrollWidth > window.innerWidth + 2,
      fixedCount: fixed.length,
      fixed,
      overlaps,
      bodyTextSample: (document.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    };
  });
}

const { username, cookiePair } = await register();
const browser = await puppeteer.launch({
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
if (cookiePair) {
  const [name, ...rest] = cookiePair.split('=');
  await page.setCookie({ name, value: rest.join('='), url: BASE, path: '/' });
}
page.on('console', (msg) => console.log(`browser:${msg.type()}: ${msg.text()}`));
page.on('pageerror', (err) => console.log(`browser:pageerror: ${err.message}`));
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForSelector('body', { timeout: 10000 });
await new Promise((resolve) => setTimeout(resolve, 1200));
const home = await layoutSnapshot(page, 'mobile-home-390x844');

await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')];
  const terminal = buttons.find((button) => /terminal/i.test(button.textContent || ''));
  terminal?.click();
});
await new Promise((resolve) => setTimeout(resolve, 1000));
const terminal = await layoutSnapshot(page, 'mobile-terminal-390x844');

await browser.close();

assert.equal(home.horizontalOverflow, false, `home horizontal overflow: ${JSON.stringify(home)}`);
assert.equal(terminal.horizontalOverflow, false, `terminal horizontal overflow: ${JSON.stringify(terminal)}`);
console.log(JSON.stringify({ ok: true, username, screenshots: ['mobile-home-390x844.png', 'mobile-terminal-390x844.png'], home, terminal }, null, 2));
