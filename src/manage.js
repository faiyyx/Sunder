// Trade management: plan of partial exits + stop moves, and live assessment at a given price.
import { floorToStep } from './calc.js';

export const DEFAULT_PLAN = {
  partials: [50, 30, 20],   // % of ORIGINAL size to sell at TP1, TP2, TP3 ... (last level closes the rest)
  beAt: 'tp1',              // 'tp1' | '1r' : when to move SL to breakeven
  beBufferPct: 0,           // move BE this % beyond entry (covers fees/spread), e.g. 0.05
  trail: 'prevtp',          // after TPk: 'prevtp' (SL -> TP k-1) | 'lock' (lock lockPct of open profit)
  lockPct: 50,              // used by 'lock' trail and as the "tighter" alternative
};

function dirSign(direction) { return direction === 'short' ? -1 : 1; }

export function breakevenPrice(trade, plan = DEFAULT_PLAN) {
  const dir = dirSign(trade.direction);
  const buf = (plan.beBufferPct || 0) / 100;
  return trade.entry * (1 + dir * buf);
}

/** Round a partial size to what the venue accepts. */
export function roundSize(size, trade) {
  const step = trade.kind === 'lots' ? (trade.lotStep || 0.01) : (trade.qtyStep || 0);
  if (!step) return Number(size.toPrecision(6));
  return Number(floorToStep(size, step).toFixed(8));
}

/**
 * Build the management plan for a trade.
 * trade: { direction, entry, sl, tps[], size, kind, perUnit, lotStep?, qtyStep? }
 * Returns steps: [{ label, price, r, pct, size, slTo, slLabel }]
 */
export function buildPlan(trade, plan = DEFAULT_PLAN) {
  const dir = dirSign(trade.direction);
  const risk1R = Math.abs(trade.entry - trade.sl);
  if (!(risk1R > 0)) return [];
  let levels = (trade.tps || [])
    .filter((p) => p != null && (p - trade.entry) * dir > 0)
    .sort((a, b) => (a - b) * dir)
    .map((price, i) => ({ label: `TP${i + 1}`, price }));
  if (!levels.length) {
    levels = [1, 2, 3].map((k) => ({ label: `${k}R`, price: trade.entry + dir * k * risk1R, synthetic: true }));
  }
  const be = breakevenPrice(trade, plan);
  // With a single target far away, protect at 1R first.
  if (levels.length === 1) {
    const r1 = trade.entry + dir * risk1R;
    if ((levels[0].price - r1) * dir > risk1R * 0.25) levels.unshift({ label: '1R', price: r1, synthetic: true });
  }
  const n = levels.length;
  const fractions = (plan.partials || DEFAULT_PLAN.partials).map((p) => Math.max(0, Math.min(100, Number(p) || 0)));
  const step = trade.kind === 'lots' ? (trade.lotStep || 0.01) : (trade.qtyStep || 0);
  const roundCum = (x) => (step > 0 ? Number((Math.round(x / step + 1e-9) * step).toFixed(8)) : Number(x.toPrecision(6)));
  const steps = [];
  let cumulative = 0;
  let cumSize = 0;
  for (let i = 0; i < n; i++) {
    const lv = levels[i];
    let pct;
    if (i === n - 1) pct = Math.max(0, 100 - cumulative);
    else {
      pct = fractions[i] != null ? fractions[i] : Math.round((100 - cumulative) / (n - i));
      pct = Math.min(pct, 100 - cumulative);
    }
    cumulative += pct;
    // size for this step = rounded cumulative target minus what earlier steps already take (keeps the plan closest to the intended %)
    const cumTarget = i === n - 1 ? trade.size : roundCum(trade.size * cumulative / 100);
    const size = Math.max(0, Number((cumTarget - cumSize).toFixed(8)));
    cumSize += size;
    let slTo; let slLabel;
    if (i === 0) {
      slTo = be; slLabel = plan.beBufferPct ? 'breakeven+' : 'breakeven';
    } else if (plan.trail === 'lock') {
      slTo = trade.entry + (lv.price - trade.entry) * ((plan.lockPct || 50) / 100);
      slLabel = `lock ${plan.lockPct || 50}%`;
    } else {
      slTo = levels[i - 1].price; slLabel = levels[i - 1].label;
    }
    steps.push({
      index: i,
      label: lv.label,
      price: lv.price,
      synthetic: !!lv.synthetic,
      r: ((lv.price - trade.entry) * dir) / risk1R,
      pct,
      size,
      stopOnly: size <= 0 && i !== n - 1,
      slTo,
      slLabel,
    });
  }
  // Positions of a single lot-step cannot be split: close everything at the first level.
  const units = step > 0 ? Math.round(trade.size / step) : Infinity;
  if (units <= 1 && steps.length > 1) {
    const first = steps[0];
    return [{ ...first, pct: 100, size: trade.size, stopOnly: false, slTo: first.slTo, slLabel: first.slLabel }];
  }
  // Make sure the final level closes at least one unit: borrow it from the last sized step.
  const last = steps[steps.length - 1];
  if (last && last.size <= 0 && steps.length > 1 && step > 0) {
    for (let j = steps.length - 2; j >= 0; j--) {
      if (steps[j].size > 0) {
        steps[j].size = Number((steps[j].size - step).toFixed(8));
        steps[j].stopOnly = steps[j].size <= 0;
        last.size = step;
        break;
      }
    }
  }
  // 'beAt: 1r' — if 1R comes before TP1, add a stop-only step at 1R.
  if (plan.beAt === '1r' && steps.length && !steps[0].synthetic) {
    const r1 = trade.entry + dir * risk1R;
    if ((steps[0].price - r1) * dir > 0) {
      steps.unshift({ index: -1, label: '1R', price: r1, synthetic: true, r: 1, pct: 0, size: 0, slTo: be, slLabel: 'breakeven', stopOnly: true });
      steps.forEach((s, i) => { s.index = i; });
    }
  }
  return steps;
}

export function pnlAt(trade, price, size) {
  const dir = dirSign(trade.direction);
  return (price - trade.entry) * dir * (trade.perUnit || 1) * size;
}

export function realizedPnl(trade) {
  return (trade.partials || []).reduce((s, p) => s + pnlAt(trade, p.price, p.size), 0);
}

export function remainingSize(trade) {
  const sold = (trade.partials || []).reduce((s, p) => s + p.size, 0);
  return Math.max(0, Number((trade.size - sold).toFixed(8)));
}

/**
 * Assess an open trade at the current price.
 * trade additionally carries: currentSl, partials[{price,size,stepIndex?}], doneSteps[]
 */
export function assess(trade, price, plan = DEFAULT_PLAN) {
  const dir = dirSign(trade.direction);
  const risk1R = Math.abs(trade.entry - trade.sl);
  const steps = buildPlan(trade, plan);
  const remaining = remainingSize(trade);
  const realized = realizedPnl(trade);
  const currentSl = trade.currentSl ?? trade.sl;
  const done = new Set(trade.doneSteps || []);
  const out = {
    price,
    r: risk1R > 0 ? ((price - trade.entry) * dir) / risk1R : null,
    move: (price - trade.entry) * dir,
    movePct: (price - trade.entry) * dir / trade.entry,
    openPnl: pnlAt(trade, price, remaining),
    realized,
    remaining,
    remainingPct: trade.size > 0 ? remaining / trade.size : 0,
    currentSl,
    lockedPnl: realized + pnlAt(trade, currentSl, remaining),
    steps: steps.map((s) => ({ ...s, reached: (price - s.price) * dir >= 0, done: done.has(s.index) })),
    status: 'hold',
    action: null,
    alternatives: [],
    next: null,
  };

  if (remaining <= 0) { out.status = 'closed'; return out; }

  // Stop hit?
  if ((price - currentSl) * dir <= 0) {
    out.status = 'stopped';
    out.action = { type: 'close', size: remaining, reason: `Price is at/through your stop (${fmt(currentSl)}). If the position is still open, close it now.` };
    return out;
  }

  const pending = out.steps.filter((s) => s.reached && !s.done);
  const be = breakevenPrice(trade, plan);
  const slBetter = (a, b) => (a - b) * dir > 0; // a is tighter (locks more) than b

  if (pending.length) {
    const sellSize = Math.min(remaining, pending.reduce((s, p) => s + p.size, 0));
    const lastPending = pending[pending.length - 1];
    const isFinal = lastPending.index === out.steps[out.steps.length - 1].index;
    let sizeToSell = isFinal ? remaining : roundSize(sellSize, trade);
    if (sizeToSell > remaining) sizeToSell = remaining;
    const slTarget = pending.reduce((best, p) => (best == null || slBetter(p.slTo, best) ? p.slTo : best), null);
    const moveSl = slTarget != null && slBetter(slTarget, currentSl) && !isFinal;
    if (sizeToSell <= 0 && !isFinal) {
      if (moveSl) {
        out.status = 'move_stop';
        out.action = { type: 'move_sl', newSl: slTarget, newSlLabel: pending.find((p) => p.slTo === slTarget)?.slLabel, stepsIdx: pending.map((p) => p.index), reason: `${pending.map((p) => p.label).join(' and ')} reached (${fmtR(lastPending.r)}) — nothing to sell at this level, just tighten the stop.` };
      } else {
        out.status = 'hold';
      }
      return finish(out, trade, price, plan, be, currentSl, remaining, realized, dir, slBetter);
    }
    out.status = 'take_profit';
    out.action = {
      type: isFinal ? 'close' : 'partial',
      size: sizeToSell,
      pct: trade.size > 0 ? sizeToSell / trade.size : 0,
      pctOfRemaining: remaining > 0 ? sizeToSell / remaining : 0,
      steps: pending.map((p) => p.label),
      newSl: moveSl ? slTarget : null,
      newSlLabel: moveSl ? pending.find((p) => p.slTo === slTarget)?.slLabel : null,
      reason: isFinal
        ? `${lastPending.label} reached (${fmtR(lastPending.r)}) — close the rest.`
        : `${pending.map((p) => p.label).join(' and ')} reached (${fmtR(lastPending.r)}).`,
    };
  } else {
    // Nothing reached that isn't handled. Is the stop where it should be?
    const doneSteps = out.steps.filter((s) => s.done);
    const bestDoneSl = doneSteps.reduce((best, s) => (best == null || slBetter(s.slTo, best) ? s.slTo : best), null);
    if (bestDoneSl != null && slBetter(bestDoneSl, currentSl)) {
      out.status = 'move_stop';
      out.action = { type: 'move_sl', newSl: bestDoneSl, newSlLabel: doneSteps.find((s) => s.slTo === bestDoneSl)?.slLabel, reason: 'You took profit but the stop is still loose — tighten it.' };
    } else if (out.r != null && out.r >= 1 && plan.beAt === '1r' && slBetter(be, currentSl)) {
      out.status = 'move_stop';
      out.action = { type: 'move_sl', newSl: be, newSlLabel: 'breakeven', reason: 'Price is 1R in profit — move the stop to breakeven.' };
    } else if (out.r != null && out.r < 0) {
      out.status = 'drawdown';
    } else {
      out.status = 'hold';
    }
  }

  return finish(out, trade, price, plan, be, currentSl, remaining, realized, dir, slBetter);
}

function finish(out, trade, price, plan, be, currentSl, remaining, realized, dir, slBetter) {
  // Next level
  const upcoming = out.steps.find((s) => !s.reached);
  if (upcoming) {
    out.next = {
      label: upcoming.label,
      price: upcoming.price,
      distance: (upcoming.price - price) * dir,
      distancePct: (upcoming.price - price) * dir / price,
      r: upcoming.r,
      pct: upcoming.pct,
      size: upcoming.size,
      slTo: upcoming.slTo,
      slLabel: upcoming.slLabel,
    };
  }

  // Alternatives when in profit
  if (out.r != null && out.r > 0.3) {
    const lock = trade.entry + (price - trade.entry) * ((plan.lockPct || 50) / 100);
    if (slBetter(lock, currentSl)) {
      out.alternatives.push({ type: 'move_sl', newSl: lock, label: `Lock ${plan.lockPct || 50}% of open profit`, locked: realized + pnlAt(trade, lock, remaining) });
    }
    if (slBetter(be, currentSl) && out.r >= 0.5) {
      out.alternatives.push({ type: 'move_sl', newSl: be, label: 'Breakeven now (risk-free)', locked: realized + pnlAt(trade, be, remaining) });
    }
    out.alternatives.push({ type: 'close', size: remaining, label: 'Close everything now', pnl: realized + out.openPnl });
  }
  return out;
}

function fmt(x) { return Number.isFinite(x) ? String(Number(x.toFixed(6))) : '—'; }
function fmtR(r) { return `${r.toFixed(1)}R`; }
