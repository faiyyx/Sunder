import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignal, parseNumber, mergeParsed } from '../src/parser.js';
import { detectInstrument } from '../src/instruments.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('parseNumber handles thousands, decimal commas and K suffix', () => {
  assert.equal(parseNumber('62,000'), 62000);
  assert.equal(parseNumber('2,650.50'), 2650.5);
  assert.equal(parseNumber('2650,50'), 2650.5);
  assert.equal(parseNumber('1,0850'), 1.085);
  assert.equal(parseNumber('62', true), 62000);
  assert.equal(parseNumber('.5'), 0.5);
});

test('gold buy with range entry and numbered TPs', () => {
  const p = parseSignal(`🔥 XAUUSD BUY NOW @ 2650-2655\nSL: 2640\nTP1: 2660\nTP2: 2670\nTP3: 2680`);
  assert.equal(p.symbol, 'XAUUSD');
  assert.equal(p.kind, 'lots');
  assert.equal(p.direction, 'long');
  assert.equal(p.entry, 2650);
  assert.deepEqual(p.entryRange, [2650, 2655]);
  assert.equal(p.sl, 2640);
  assert.deepEqual(p.tps, [2660, 2670, 2680]);
  assert.equal(p.entryIsMarket, false);
});

test('gold sell, lowercase keywords, no colons', () => {
  const p = parseSignal(`GOLD SELL 2655\nSl 2665\nTp 2645\nTp 2635`);
  assert.equal(p.symbol, 'XAUUSD');
  assert.equal(p.direction, 'short');
  assert.equal(p.entry, 2655);
  assert.equal(p.sl, 2665);
  assert.deepEqual(p.tps, [2645, 2635]);
});

test('crypto long with thousands separators, slash targets and leverage', () => {
  const p = parseSignal(`BTC/USDT LONG 📈\nEntry: 62,000 - 61,500\nTargets: 63,000 / 64,000 / 65,000\nStop loss: 60,000\nLeverage: 10x`);
  assert.equal(p.symbol, 'BTCUSDT');
  assert.equal(p.kind, 'usdt');
  assert.equal(p.direction, 'long');
  assert.equal(p.entry, 62000);
  assert.deepEqual(p.entryRange, [61500, 62000]);
  assert.equal(p.sl, 60000);
  assert.deepEqual(p.tps, [63000, 64000, 65000]);
  assert.equal(p.leverage, 10);
});

test('hashtag ticker, take-profit with hyphen, isolated leverage', () => {
  const p = parseSignal(`#ETH/USDT 📈 LONG\nEntry 3400-3350\nTake-Profit 3500 3600 3700\nStop-Loss 3250\nIsolated 20x`);
  assert.equal(p.symbol, 'ETHUSDT');
  assert.equal(p.direction, 'long');
  assert.deepEqual(p.entryRange, [3350, 3400]);
  assert.equal(p.sl, 3250);
  assert.deepEqual(p.tps, [3500, 3600, 3700]);
  assert.equal(p.leverage, 20);
});

test('sell stop order type is not mistaken for a stop loss', () => {
  const p = parseSignal(`SELL STOP GOLD 2640\nSL 2650\nTP 2620`);
  assert.equal(p.direction, 'short');
  assert.equal(p.entry, 2640);
  assert.equal(p.sl, 2650);
  assert.deepEqual(p.tps, [2620]);
});

test('OCR noise: O for 0, 5L for SL, pips and timestamps', () => {
  const p = parseSignal(`Entry: 2650.5O\n5L: 2640\nTP1 : 2660 ✅ (+10 pips)\nTP2 : 267O\n12:30 PM`);
  assert.equal(p.entry, 2650.5);
  assert.equal(p.sl, 2640);
  assert.deepEqual(p.tps, [2660, 2670]);
  assert.equal(p.direction, 'long');
  assert.equal(p.directionSource, 'inferred');
});

test('forex buy limit with 4-decimal prices', () => {
  const p = parseSignal(`EURUSD buy limit 1.0850 sl 1.0820 tp 1.0900 tp 1.0950`);
  assert.equal(p.symbol, 'EURUSD');
  assert.equal(p.kind, 'lots');
  assert.equal(p.instrument.contractSize, 100000);
  close(p.entry, 1.085);
  close(p.sl, 1.082);
  assert.deepEqual(p.tps, [1.09, 1.095]);
});

test('percentage stop and targets are converted to prices', () => {
  const p = parseSignal(`SOL long entry 145.5 sl 3% tp 5% tp 8%`);
  assert.equal(p.symbol, 'SOLUSDT');
  close(p.sl, 145.5 * 0.97);
  assert.equal(p.tps.length, 2);
  close(p.tps[0], 145.5 * 1.05);
  close(p.tps[1], 145.5 * 1.08);
});

test('entry guessed from an unlabeled number after the symbol', () => {
  const p = parseSignal(`XAUUSD 2650 / SL 2640 / TP 2660`);
  assert.equal(p.entry, 2650);
  assert.equal(p.entrySource, 'guess');
  assert.equal(p.sl, 2640);
  assert.deepEqual(p.tps, [2660]);
});

test('market entry when no price given', () => {
  const p = parseSignal(`Buy gold now sl 2640 tp 2660 2670`);
  assert.equal(p.entry, null);
  assert.equal(p.entryIsMarket, true);
  assert.equal(p.sl, 2640);
  assert.deepEqual(p.tps, [2660, 2670]);
  assert.ok(p.flags.some((f) => f.code === 'no_entry'));
});

test('ratio and RR text does not become a target', () => {
  const p = parseSignal(`US30 BUY 42500 SL 42350 TP 42800 1:2 RR`);
  assert.equal(p.symbol, 'US30');
  assert.equal(p.entry, 42500);
  assert.deepEqual(p.tps, [42800]);
  const q = parseSignal(`GOLD BUY @2650 SL 2640 TP 2670 RR 2`);
  assert.deepEqual(q.tps, [2670]);
});

test('single-line signal with mixed separators', () => {
  const p = parseSignal(`XAUUSD SELL 2655/2660 SL 2670 TP 2645 2635 2625`);
  assert.equal(p.direction, 'short');
  assert.deepEqual(p.entryRange, [2655, 2660]);
  assert.equal(p.sl, 2670);
  assert.deepEqual(p.tps, [2645, 2635, 2625]);
});

test('TradingView position tool text', () => {
  const p = parseSignal(`Long Position\nOpen: 2650.00\nTarget: 2680.00 (30.00) 1.13%\nStop: 2640.00 (10.00) 0.38%\nRisk/Reward Ratio: 3`);
  assert.equal(p.direction, 'long');
  assert.equal(p.entry, 2650);
  assert.equal(p.sl, 2640);
  assert.deepEqual(p.tps, [2680]);
});

test('short with emoji direction only', () => {
  const p = parseSignal(`XAUUSD 📉\nEntry 2660\nSL 2670\nTP 2650`);
  assert.equal(p.direction, 'short');
  assert.equal(p.directionSource, 'emoji');
});

test('direction conflict is flagged', () => {
  const p = parseSignal(`GOLD BUY 2650 SL 2660 TP 2640`);
  assert.ok(p.flags.some((f) => f.code === 'direction_conflict'));
});

test('DCA entries become a range', () => {
  const p = parseSignal(`BTC LONG\nEntry 1: 62000\nEntry 2: 61000\nSL 59500\nTP 64000`);
  assert.deepEqual(p.entryRange, [61000, 62000]);
  assert.equal(p.entry, 62000);
});

test('K suffix prices', () => {
  const p = parseSignal(`BTC long entry 62k sl 60.5k tp 65k`);
  assert.equal(p.entry, 62000);
  assert.equal(p.sl, 60500);
  assert.deepEqual(p.tps, [65000]);
});

test('timeframes, dates and list markers ignored', () => {
  const p = parseSignal(`1. XAUUSD H4 buy 15/05/2024\n2. entry 2650\n3. sl 2640 (15M chart)\n4. tp 2660`);
  assert.equal(p.entry, 2650);
  assert.equal(p.sl, 2640);
  assert.deepEqual(p.tps, [2660]);
});

test('Telegram style with multiple emojis and lot advice', () => {
  const p = parseSignal(`🟡 GOLD BUY 🟡\n\n💰 Entry: 2648 - 2645\n🛑 SL: 2638\n🎯 TP1: 2655\n🎯 TP2: 2662\n🎯 TP3: 2670\n\nUse 0.01 lot per $100\nRisk 2%`);
  assert.equal(p.direction, 'long');
  assert.deepEqual(p.entryRange, [2645, 2648]);
  assert.equal(p.sl, 2638);
  assert.deepEqual(p.tps, [2655, 2662, 2670]);
  assert.equal(p.riskPct, 2);
});

test('detects broker-suffixed gold symbol and silver', () => {
  assert.equal(detectInstrument('XAUUSDm buy').symbol, 'XAUUSD');
  assert.equal(detectInstrument('XAUUSD.m sell').symbol, 'XAUUSD');
  assert.equal(detectInstrument('silver buy 31.5').symbol, 'XAGUSD');
  assert.equal(detectInstrument('NAS100 sell').symbol, 'NAS100');
  assert.equal(detectInstrument('$PEPE long').symbol, 'PEPEUSDT');
  assert.equal(detectInstrument('1000PEPEUSDT long').symbol, '1000PEPEUSDT');
  assert.equal(detectInstrument('ETHUSDT.P short').symbol, 'ETHUSDT');
  assert.equal(detectInstrument('BTCUSD long').kind, 'usdt');
  assert.equal(detectInstrument('USDJPY buy').quote, 'JPY');
  assert.equal(detectInstrument('random words here'), null);
});

test('mergeParsed fills gaps from the secondary parse', () => {
  const a = parseSignal('GOLD BUY');
  const b = parseSignal('entry 2650 sl 2640 tp 2660');
  const m = mergeParsed(a, b);
  assert.equal(m.symbol, 'XAUUSD');
  assert.equal(m.direction, 'long');
  assert.equal(m.entry, 2650);
  assert.equal(m.sl, 2640);
  assert.deepEqual(m.tps, [2660]);
  assert.ok(!m.flags.some((f) => f.code === 'no_entry'));
});

test('implausible values are dropped', () => {
  const p = parseSignal(`GOLD BUY 2650 SL 2640 TP 2660 TP 10`);
  assert.deepEqual(p.tps, [2660]);
});

test('short term / long term words do not set direction', () => {
  const p = parseSignal(`GOLD short term view: sell 2650 sl 2660 tp 2640`);
  assert.equal(p.direction, 'short');
  assert.equal(p.entry, 2650);
});

import { splitSignals, parseSignals, signalScore } from '../src/parser.js';

test('splitSignals separates two chat messages', () => {
  const text = `XAUUSD SELL 2655/2660\nSL 2670\nTP 2645 2635 2625\n\nUse proper risk management\n\nSOL long\nentry 145.5\nsl 141\ntp 152 / 158 / 165\nlev 10x`;
  const segs = splitSignals(text);
  assert.equal(segs.length, 2);
  const all = parseSignals(text);
  assert.equal(all.length, 2);
  assert.equal(all[0].symbol, 'XAUUSD');
  assert.deepEqual(all[0].tps, [2645, 2635, 2625]);
  assert.equal(all[1].symbol, 'SOLUSDT');
  assert.equal(all[1].entry, 145.5);
  assert.equal(all[1].sl, 141);
  assert.equal(all[1].leverage, 10);
});

test('splitSignals keeps a single signal with trailing commentary intact', () => {
  const text = `XAUUSD BUY\nEntry 2650\nSL 2640\nTP1 2660\nTP2 2670 (XAUUSD weekly high)\nSell 50% at TP1 and move SL to BE\nGood luck`;
  const all = parseSignals(text);
  assert.equal(all.length, 1);
  assert.deepEqual(all[0].tps, [2660, 2670]);
  assert.equal(all[0].direction, 'long');
});

test('parseSignals on OCR text with header chrome and two signals', () => {
  const text = `«— Gold Signals VIP                9:41\n\n& XAUUSD BUY NOW &\n\nEntry: 2650 - 2655\nSL: 2640\n\nTP1: 2660\nTP2: 2670\nTP3: 2680 ©\n\nRisk 1-2% only\n12:30 PM\n\nGOLD SELL @ 2661.50\nStop loss 2668\n\nTake profit 2655 / 2648 / 2640\n12:32 PM`;
  const all = parseSignals(text);
  assert.equal(all.length, 2);
  assert.equal(all[0].direction, 'long');
  assert.deepEqual(all[0].entryRange, [2650, 2655]);
  assert.deepEqual(all[0].tps, [2660, 2670, 2680]);
  assert.equal(all[1].direction, 'short');
  assert.equal(all[1].entry, 2661.5);
  assert.equal(all[1].sl, 2668);
  assert.deepEqual(all[1].tps, [2655, 2648, 2640]);
  assert.ok(signalScore(all[0]) >= signalScore(all[1]));
});

test('parseSignals returns one item for plain text', () => {
  const all = parseSignals('GOLD BUY 2650 SL 2640 TP 2660');
  assert.equal(all.length, 1);
  assert.equal(all[0].sl, 2640);
});
