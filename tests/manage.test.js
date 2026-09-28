import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, assess, DEFAULT_PLAN, remainingSize, realizedPnl } from '../src/manage.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

const goldLong = () => ({
  kind: 'lots', direction: 'long', entry: 2650, sl: 2640, tps: [2660, 2670, 2680], size: 0.1, perUnit: 100, lotStep: 0.01,
  currentSl: 2640, partials: [], doneSteps: [],
});

test('plan: 3 TPs -> 50/30/20 with BE then trail to previous TP', () => {
  const steps = buildPlan(goldLong(), DEFAULT_PLAN);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.pct), [50, 30, 20]);
  assert.deepEqual(steps.map((s) => s.size), [0.05, 0.03, 0.02]);
  assert.equal(steps[0].slTo, 2650);
  assert.equal(steps[0].slLabel, 'breakeven');
  assert.equal(steps[1].slTo, 2660);
  assert.equal(steps[1].slLabel, 'TP1');
  assert.equal(steps[2].slTo, 2670);
  close(steps[2].r, 3);
});

test('plan: no TPs -> synthetic 1R/2R/3R levels', () => {
  const t = { ...goldLong(), tps: [] };
  const steps = buildPlan(t, DEFAULT_PLAN);
  assert.deepEqual(steps.map((s) => s.label), ['1R', '2R', '3R']);
  assert.deepEqual(steps.map((s) => s.price), [2660, 2670, 2680]);
});

test('plan: single far TP gets a 1R protect step', () => {
  const t = { ...goldLong(), tps: [2680] };
  const steps = buildPlan(t, DEFAULT_PLAN);
  assert.deepEqual(steps.map((s) => s.label), ['1R', 'TP1']);
  assert.equal(steps[0].pct, 50);
  assert.equal(steps[1].pct, 50);
});

test('plan: short direction and lock trailing', () => {
  const t = { kind: 'usdt', direction: 'short', entry: 3400, sl: 3500, tps: [3300, 3200], size: 2, perUnit: 1, partials: [], doneSteps: [] };
  const steps = buildPlan(t, { ...DEFAULT_PLAN, trail: 'lock', lockPct: 50 });
  assert.equal(steps[0].slTo, 3400);
  assert.equal(steps[1].slTo, 3300); // lock 50% of the move to TP2 (3400 -> 3200 = 200; lock 100 -> 3300)
  assert.equal(steps[1].pct, 50);
});

test('assess: below 1R -> hold with next level info', () => {
  const a = assess(goldLong(), 2655, DEFAULT_PLAN);
  assert.equal(a.status, 'hold');
  close(a.r, 0.5);
  close(a.openPnl, 50);
  assert.equal(a.next.label, 'TP1');
  assert.equal(a.next.distance, 5);
});

test('assess: drawdown', () => {
  const a = assess(goldLong(), 2645, DEFAULT_PLAN);
  assert.equal(a.status, 'drawdown');
  close(a.openPnl, -50);
});

test('assess: stop hit', () => {
  const a = assess(goldLong(), 2639, DEFAULT_PLAN);
  assert.equal(a.status, 'stopped');
  assert.equal(a.action.type, 'close');
});

test('assess: TP1 reached -> sell 50%, SL to breakeven', () => {
  const a = assess(goldLong(), 2661, DEFAULT_PLAN);
  assert.equal(a.status, 'take_profit');
  assert.equal(a.action.type, 'partial');
  close(a.action.size, 0.05);
  close(a.action.pct, 0.5);
  assert.equal(a.action.newSl, 2650);
  assert.deepEqual(a.action.steps, ['TP1']);
});

test('assess: price jumped past TP1 and TP2 -> combined partial, SL to TP1', () => {
  const a = assess(goldLong(), 2672, DEFAULT_PLAN);
  assert.equal(a.action.type, 'partial');
  close(a.action.size, 0.08);
  assert.equal(a.action.newSl, 2660);
  assert.deepEqual(a.action.steps, ['TP1', 'TP2']);
});

test('assess: after TP1 done, hold until TP2; stop already moved', () => {
  const t = goldLong();
  t.partials = [{ price: 2660, size: 0.05, stepIndex: 0 }];
  t.doneSteps = [0];
  t.currentSl = 2650;
  const a = assess(t, 2665, DEFAULT_PLAN);
  assert.equal(a.status, 'hold');
  close(a.remaining, 0.05);
  close(a.realized, 50);
  close(a.openPnl, 75);
  close(a.lockedPnl, 50);
  assert.equal(a.next.label, 'TP2');
});

test('assess: partial taken but stop not moved -> move_stop', () => {
  const t = goldLong();
  t.partials = [{ price: 2660, size: 0.05, stepIndex: 0 }];
  t.doneSteps = [0];
  const a = assess(t, 2665, DEFAULT_PLAN);
  assert.equal(a.status, 'move_stop');
  assert.equal(a.action.newSl, 2650);
});

test('assess: final target -> close the rest', () => {
  const t = goldLong();
  t.partials = [{ price: 2660, size: 0.05 }, { price: 2670, size: 0.03 }];
  t.doneSteps = [0, 1];
  t.currentSl = 2660;
  const a = assess(t, 2681, DEFAULT_PLAN);
  assert.equal(a.action.type, 'close');
  close(a.action.size, 0.02);
  assert.equal(a.action.newSl, null);
});

test('assess: alternatives offered when in profit', () => {
  const a = assess(goldLong(), 2658, DEFAULT_PLAN);
  const lock = a.alternatives.find((x) => x.label.startsWith('Lock'));
  assert.ok(lock);
  close(lock.newSl, 2654);
  assert.ok(a.alternatives.some((x) => x.label.startsWith('Breakeven')));
  assert.ok(a.alternatives.some((x) => x.type === 'close'));
});

test('assess: beAt 1r moves stop at 1R before TP1', () => {
  const t = { ...goldLong(), tps: [2675] };
  const a = assess(t, 2661, { ...DEFAULT_PLAN, beAt: '1r' });
  assert.equal(a.status, 'take_profit');
  assert.equal(a.action.newSl, 2650);
});

test('remaining and realized helpers', () => {
  const t = goldLong();
  t.partials = [{ price: 2660, size: 0.05 }];
  close(remainingSize(t), 0.05);
  close(realizedPnl(t), 50);
});

test('plan: small positions use cumulative rounding to the lot step', () => {
  const t = { ...goldLong(), size: 0.05 };
  const steps = buildPlan(t, DEFAULT_PLAN);
  assert.deepEqual(steps.map((s) => s.size), [0.03, 0.01, 0.01]);
  close(steps.reduce((a, s) => a + s.size, 0), 0.05);
  const tiny = { ...goldLong(), size: 0.02 };
  const st = buildPlan(tiny, DEFAULT_PLAN);
  assert.deepEqual(st.map((s) => s.size), [0.01, 0, 0.01]);
  assert.equal(st[1].stopOnly, true);
  const a = assess({ ...tiny, partials: [{ price: 2660, size: 0.01 }], doneSteps: [0], currentSl: 2650 }, 2671, DEFAULT_PLAN);
  assert.equal(a.status, 'move_stop');
  assert.equal(a.action.newSl, 2660);
  const one = buildPlan({ ...goldLong(), size: 0.01 }, DEFAULT_PLAN);
  assert.equal(one.length, 1);
  assert.equal(one[0].size, 0.01);
  assert.equal(one[0].pct, 100);
  const b = assess({ ...goldLong(), size: 0.01 }, 2661, DEFAULT_PLAN);
  assert.equal(b.action.type, 'close');
  close(b.action.size, 0.01);
});

test('plan: crypto quantities keep 6 significant digits', () => {
  const t = { kind: 'usdt', direction: 'long', entry: 60000, sl: 59000, tps: [61000, 62000, 63000], size: 0.0512345, perUnit: 1, partials: [], doneSteps: [] };
  const steps = buildPlan(t, DEFAULT_PLAN);
  close(steps.reduce((a, s) => a + s.size, 0), 0.0512345, 1e-7);
  close(steps[0].size, 0.0256173, 1e-6);
});
