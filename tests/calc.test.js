import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeLots, sizeUsdt, sizeTrade, floorToStep } from '../src/calc.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('floorToStep rounds down without float drift', () => {
  assert.equal(floorToStep(0.0499999, 0.01), 0.04);
  close(floorToStep(0.05, 0.01), 0.05);
  close(floorToStep(0.07, 0.01), 0.07);
  close(floorToStep(1.23456, 0.001), 1.234);
});

test('gold: $50 risk with 10 point stop = 0.05 lots', () => {
  const r = sizeLots({ entry: 2650, sl: 2640, risk: 50, contractSize: 100 });
  assert.equal(r.dist, 10);
  assert.equal(r.riskPerLot, 1000);
  close(r.lots, 0.05);
  close(r.riskActual, 50);
  assert.equal(r.belowMin, false);
});

test('gold: rounds down to lot step so risk is never exceeded', () => {
  const r = sizeLots({ entry: 2650, sl: 2637, risk: 50, contractSize: 100 });
  close(r.lotsRaw, 50 / 1300);
  close(r.lots, 0.03);
  close(r.riskActual, 39);
});

test('gold: below minimum lot flagged', () => {
  const r = sizeLots({ entry: 2650, sl: 2600, risk: 20, contractSize: 100 });
  assert.equal(r.belowMin, true);
  assert.equal(r.lots, 0);
  assert.equal(r.minLotRisk, 50);
});

test('gold: commission per lot reduces size', () => {
  const r = sizeLots({ entry: 2650, sl: 2640, risk: 50, contractSize: 100, commissionPerLot: 7 });
  close(r.lotsRaw, 50 / 1007);
  close(r.lots, 0.04);
});

test('USDJPY: quote conversion applied', () => {
  const r = sizeLots({ entry: 150, sl: 149.5, risk: 100, contractSize: 100000, quoteToUsd: 1 / 150 });
  close(r.riskPerLot, 0.5 * 100000 / 150);
  close(r.lots, 0.3);
});

test('crypto: $50 risk, 1.667% stop = $3000 notional', () => {
  const r = sizeUsdt({ entry: 60000, sl: 59000, risk: 50 });
  close(r.distPct, 1000 / 60000);
  close(r.notional, 3000);
  close(r.qty, 0.05);
  close(r.margin, 3000);
  close(r.riskActual, 50);
  assert.equal(r.liqWarning, false);
});

test('crypto: leverage sets margin and liquidation warning', () => {
  const r = sizeUsdt({ entry: 60000, sl: 57000, risk: 100, leverage: 20 });
  close(r.notional, 2000);
  close(r.margin, 100);
  assert.equal(r.liqWarning, true);
  const ok = sizeUsdt({ entry: 60000, sl: 59400, risk: 100, leverage: 10 });
  assert.equal(ok.liqWarning, false);
});

test('crypto: fees included in risk', () => {
  const r = sizeUsdt({ entry: 100, sl: 98, risk: 20, feePct: 0.05 });
  close(r.notional, 20 / (0.02 + 0.001));
  close(r.riskActual, 20);
});

test('crypto: qty step rounding', () => {
  const r = sizeUsdt({ entry: 60000, sl: 59000, risk: 50, qtyStep: 0.01 });
  close(r.qty, 0.05);
  const r2 = sizeUsdt({ entry: 60000, sl: 59000, risk: 55, qtyStep: 0.01 });
  close(r2.qty, 0.05);
  close(r2.notional, 3000);
});

test('sizeTrade validates SL side and computes targets', () => {
  assert.equal(sizeTrade({ kind: 'lots', direction: 'long', entry: 2650, sl: 2660, risk: 50 }).error, 'SL must be below entry for a BUY');
  const r = sizeTrade({ kind: 'lots', direction: 'long', entry: 2650, sl: 2640, tps: [2660, 2670, 2680], risk: 50, contractSize: 100 });
  close(r.lots, 0.05);
  assert.equal(r.targets.length, 3);
  close(r.targets[0].r, 1);
  close(r.targets[0].profit, 50);
  close(r.targets[2].r, 3);
  close(r.targets[2].profit, 150);
  const c = sizeTrade({ kind: 'usdt', direction: 'short', entry: 3400, sl: 3500, tps: [3300, 3200], risk: 40 });
  close(c.notional, 40 / (100 / 3400));
  close(c.targets[0].profit, 40);
  close(c.targets[1].r, 2);
});
