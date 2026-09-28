// End-to-end smoke test: drives the app in headless Chromium on a phone-sized viewport.
// Usage: npm i -D playwright-core && npx playwright install chromium   (or set CHROMIUM_PATH)
//        npm run smoke
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'smoke-output');
fs.mkdirSync(OUT, { recursive: true });
const server = spawn('node', [path.join(ROOT, 'scripts', 'serve.js')], { env: { ...process.env, PORT: '8123' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const BASE = 'http://localhost:8123/';
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ✓', msg); else { console.log('  ✗', msg); failures.push(msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

// Render the HTML chat fixtures to PNG screenshots (what a user would share from Telegram/WhatsApp).
const fixtures = {};
{
  const fp = await browser.newPage({ viewport: { width: 1080, height: 1100 } });
  for (const [name, w, h] of [['chat-dark', 1080, 1100], ['chat-small', 390, 420]]) {
    await fp.setViewportSize({ width: w, height: h });
    await fp.setContent(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', `${name}.html`), 'utf8'));
    fixtures[name] = path.join(OUT, `${name}.png`);
    await fp.screenshot({ path: fixtures[name] });
  }
  await fp.close();
}
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'allow' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

console.log('1. load');
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('#sigText');
check(await page.title() === 'SignalSize', 'title');

console.log('2. gold signal → lots');
await page.fill('#sigText', '🔥 XAUUSD BUY NOW @ 2650-2655\nSL: 2640\nTP1: 2660\nTP2: 2670\nTP3: 2680');
await page.fill('#fRisk', '50');
await sleep(400);
check((await page.inputValue('#fSymbol')) === 'XAUUSD', 'symbol filled');
check((await page.inputValue('#fEntry')) === '2650', 'entry filled');
check((await page.inputValue('#fSl')) === '2640', 'sl filled');
const tpVals = await page.$$eval('#tpList input', (els) => els.map((e) => e.value));
check(JSON.stringify(tpVals) === JSON.stringify(['2660', '2670', '2680']), `tps filled ${tpVals}`);
const big = await page.textContent('#resultCard .big');
check(big.trim() === '0.05', `lots = ${big.trim()} (expected 0.05)`);
check((await page.textContent('#resultCard')).includes('TP3'), 'targets table');
await page.screenshot({ path: path.join(OUT, '1-size-gold.png'), fullPage: true });

console.log('3. save → manage');
await page.click('#btnSave');
await page.waitForSelector('#mPrice');
check(await page.$eval('#tab-manage', (e) => e.classList.contains('active')), 'manage tab active');
await page.fill('#mPrice', '2655');
await sleep(150);
let dyn = await page.textContent('#mDynamic');
check(/hold/i.test(dyn) && dyn.includes('TP1'), 'at 2655: hold, next TP1');
await page.fill('#mPrice', '2661');
await sleep(150);
dyn = await page.textContent('#mDynamic');
check(/Sell\s*0\.03 lots/.test(dyn) && dyn.includes('Move stop to 2650.00'), 'at 2661: sell 0.03 lots (of 0.05), stop → 2650');
await page.screenshot({ path: path.join(OUT, '2-manage-tp1.png'), fullPage: true });
await page.click('button[data-act="sold"]');
await sleep(150);
await page.click('button[data-act="movesl"]');
await sleep(200);
const head = await page.textContent('#manageView');
check(head.includes('2650') && head.includes('remaining'), 'stop moved + remaining shown');
await page.fill('#mPrice', '2665');
await sleep(150);
dyn = await page.textContent('#mDynamic');
check(/hold/i.test(dyn) && dyn.includes('TP2'), 'after TP1 done at 2665: hold until TP2');
await page.fill('#mPrice', '2671');
await sleep(150);
dyn = await page.textContent('#mDynamic');
check(/Sell\s*0\.01 lots/.test(dyn) && dyn.includes('Move stop to 2660.00'), 'at 2671: sell 0.01, stop → 2660');
await page.fill('#mPrice', '2649');
await sleep(150);
dyn = await page.textContent('#mDynamic');
check(/stop hit/i.test(dyn), 'at 2649 (below moved stop): stop hit');
await page.screenshot({ path: path.join(OUT, '3-manage-tp2.png'), fullPage: true });
await page.click('#btnBack');
await sleep(100);
check((await page.textContent('#manageView')).includes('Open (1)'), 'trade list shows open trade');

console.log('4. crypto signal → USDT');
await page.click('.tabbar button[data-tab="size"]');
await page.click('#btnClear');
await page.fill('#sigText', 'BTC/USDT LONG 📈\nEntry: 60,000\nTargets: 61,000 / 62,000\nStop loss: 59,000\nLeverage: 10x');
await sleep(400);
check((await page.inputValue('#fSymbol')) === 'BTCUSDT', 'crypto symbol');
check(await page.$eval('#fKind button[data-v="usdt"]', (b) => b.classList.contains('on')), 'kind = usdt');
check((await page.inputValue('#fLev')) === '10', 'leverage 10');
const bigC = (await page.textContent('#resultCard .big')).trim();
check(bigC === '3,000', `notional = ${bigC} (expected 3,000)`);
const resTxt = await page.textContent('#resultCard');
check(resTxt.includes('0.05 BTC') && resTxt.includes('300.00 USDT'), 'qty 0.05 BTC, margin 300 USDT');
await page.screenshot({ path: path.join(OUT, '4-size-crypto.png'), fullPage: true });

console.log('5. two signals in one text → picker');
await page.fill('#sigText', 'XAUUSD SELL 2655/2660\nSL 2670\nTP 2645 2635 2625\n\nSOL long\nentry 145.5\nsl 141\ntp 152 / 158 / 165\nlev 10x');
await sleep(400);
const chips = await page.$$('#signalPicker .chip');
check(chips.length === 2, `picker shows ${chips.length} signals`);
await chips[1].click();
await sleep(200);
check((await page.inputValue('#fSymbol')) === 'SOLUSDT', 'picked SOL');

console.log('6. settings');
await page.click('.tabbar button[data-tab="settings"]');
await page.fill('#sBalance', '5000');
await page.dispatchEvent('#sBalance', 'change');
await sleep(100);
await page.click('.tabbar button[data-tab="size"]');
await page.fill('#fRiskPct', '1');
await sleep(100);
check((await page.inputValue('#fRisk')) === '50', 'risk % of balance → $50');
await page.click('.tabbar button[data-tab="settings"]');
await page.screenshot({ path: path.join(OUT, '5-settings.png'), fullPage: true });

console.log('7. OCR in browser');
await page.click('.tabbar button[data-tab="size"]');
await page.click('#btnClear');
await page.setInputFiles('#fileInput', fixtures['chat-dark']);
const t0 = Date.now();
await page.waitForFunction(() => /Read in|Could not|No text/.test(document.getElementById('ocrStatus').textContent), null, { timeout: 120000 });
const st = await page.textContent('#ocrStatus');
console.log('   ocr status:', st, `(${Date.now() - t0}ms wall)`);
check(/Read in/.test(st), 'OCR ran');
const ocrChips = await page.$$('#signalPicker .chip');
check(ocrChips.length === 2, `OCR found ${ocrChips.length} signals`);
console.log('   ocr text:', JSON.stringify(await page.textContent('#ocrText')));
const chipLabels = await page.$$eval('#signalPicker .chip', (els) => els.map((e) => e.textContent));
console.log('   chips:', chipLabels.join(' | '));
check(chipLabels.some((l) => l.includes('XAUUSD BUY')) && chipLabels.some((l) => l.includes('XAUUSD SELL')), 'OCR candidates: XAUUSD BUY + XAUUSD SELL');
await ocrChips[0].click(); await sleep(200);
check((await page.inputValue('#fEntry')) === '2650' && (await page.inputValue('#fSl')) === '2640', 'OCR signal 1 filled (entry 2650, sl 2640)');
check((await page.textContent('#resultCard .big')).trim() === '0.05', 'OCR signal sized to 0.05 lots');
await page.screenshot({ path: path.join(OUT, '6-ocr.png'), fullPage: true });

console.log('8. service worker + offline');
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller != null, null, { timeout: 20000 }).catch(() => {});
const swState = await page.evaluate(async () => ({ controlled: !!navigator.serviceWorker.controller, keys: await caches.keys() }));
console.log('   sw:', JSON.stringify(swState));
check(swState.controlled, 'page controlled by service worker');
await sleep(1500);
const ocrCached = await page.evaluate(async () => { const c = await caches.open('signalsize-ocr-v7.0.0'); const k = await c.keys(); return k.map((r) => r.url.split('/').pop()); });
console.log('   ocr cache:', ocrCached.join(', '));
check(ocrCached.includes('eng.traineddata.gz') && ocrCached.some((f) => f.includes('tesseract-core')), 'OCR pack precached by SW');
await context.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('#sigText', { timeout: 10000 });
check(await page.$eval('#netPill', (e) => e.textContent) === 'offline', 'offline reload works (pill shows offline)');
const tradesPersist = await page.evaluate(() => JSON.parse(localStorage.getItem('signalsize.trades.v1') || '[]').length);
check(tradesPersist === 1, 'trade persisted across reload');
await page.setInputFiles('#fileInput', fixtures['chat-small']);
await page.waitForFunction(() => /Read in|Could not|No text/.test(document.getElementById('ocrStatus').textContent), null, { timeout: 120000 });
const stOff = await page.textContent('#ocrStatus');
console.log('   offline ocr status:', stOff);
check(/Read in/.test(stOff), 'OCR works offline');
const offChips = await page.$$eval('#signalPicker .chip', (els) => els.map((e) => e.textContent));
console.log('   offline chips:', offChips.join(' | '));
check(offChips.some((l) => l.includes('XAUUSD SELL') && l.includes('2670')) && offChips.some((l) => l.includes('SOLUSDT')), 'offline OCR parsed both signals in the small screenshot');
check(['XAUUSD', 'SOLUSDT'].includes(await page.inputValue('#fSymbol')), 'a candidate was applied to the form');
await context.setOffline(false);

console.log('9. share target');
const shareResult = await page.evaluate(async () => {
  const fd = new FormData(); fd.append('title', ''); fd.append('text', 'GOLD SELL 2700 SL 2710 TP 2690 2680');
  const r = await fetch('share-target', { method: 'POST', body: fd });
  return { url: r.url, status: r.status, redirected: r.redirected };
});
console.log('   share:', JSON.stringify(shareResult));
const shareCached = await page.evaluate(async () => { const c = await caches.open('signalsize-share'); return !!(await c.match(new URL('./shared-text', location.href).href)); });
check(shareResult.status === 200 && shareCached, 'share-target POST handled by SW (text stashed)');
await page.goto(BASE + '?shared=1', { waitUntil: 'load' });
await sleep(500);
check((await page.inputValue('#sigText')).includes('GOLD SELL 2700'), 'shared text loaded into the app');
check((await page.inputValue('#fSl')) === '2710', 'shared text parsed');

console.log('\nerrors:', errors.length ? errors : 'none');
console.log(failures.length ? `\nFAILED (${failures.length}): ${failures.join(' | ')}` : '\nALL CHECKS PASSED');
await browser.close();
server.kill();
process.exit(failures.length || errors.length ? 1 : 0);
