// Position sizing math.

const EPS = 1e-9;

export function floorToStep(x, step) {
  if (!step || step <= 0) return x;
  return Math.floor(x / step + EPS) * step;
}

export function roundToStep(x, step) {
  if (!step || step <= 0) return x;
  return Math.round(x / step) * step;
}

/**
 * Lot-based sizing (gold, FX, indices, CFDs).
 * riskPerLot = distance * contractSize * quoteToUsd + commissionPerLot
 */
export function sizeLots({ entry, sl, risk, contractSize = 100, quoteToUsd = 1, lotStep = 0.01, minLot = 0.01, maxLot = 0, commissionPerLot = 0 }) {
  const dist = Math.abs(entry - sl);
  if (!(dist > 0) || !(risk > 0) || !(contractSize > 0)) return null;
  const pnlPerLot = dist * contractSize * quoteToUsd; // loss per lot at SL, before commission
  const riskPerLot = pnlPerLot + (commissionPerLot || 0);
  const lotsRaw = risk / riskPerLot;
  let lots = floorToStep(lotsRaw, lotStep);
  lots = Number(lots.toFixed(6));
  const belowMin = lotsRaw + EPS < minLot;
  if (belowMin) lots = 0;
  const aboveMax = maxLot > 0 && lots > maxLot;
  if (aboveMax) lots = maxLot;
  return {
    kind: 'lots',
    dist,
    pnlPerLot,
    riskPerLot,
    lotsRaw,
    lots,
    riskActual: lots * riskPerLot,
    belowMin,
    minLot,
    minLotRisk: minLot * riskPerLot,
    aboveMax,
    valuePerUnit: contractSize * quoteToUsd, // $ P&L per 1.0 price move per lot
  };
}

/**
 * Notional sizing for crypto: how much quote currency (USDT) to buy.
 * risk = notional * distPct + fees  ->  notional = risk / (distPct + 2*fee)
 */
export function sizeUsdt({ entry, sl, risk, leverage = 1, feePct = 0, qtyStep = 0 }) {
  const dist = Math.abs(entry - sl);
  if (!(dist > 0) || !(risk > 0) || !(entry > 0)) return null;
  const distPct = dist / entry;
  const fee = (feePct || 0) / 100;
  const denom = distPct + 2 * fee;
  let notional = risk / denom;
  let qty = notional / entry;
  if (qtyStep > 0) { qty = floorToStep(qty, qtyStep); notional = qty * entry; }
  const lev = leverage && leverage > 0 ? leverage : 1;
  const margin = notional / lev;
  // Rough isolated-margin liquidation distance ≈ 1/leverage minus maintenance; warn when the SL sits past ~80% of it.
  const liqDist = lev > 1 ? 1 / lev : Infinity;
  const liqWarning = lev > 1 && distPct >= liqDist * 0.8;
  return {
    kind: 'usdt',
    dist,
    distPct,
    notional,
    qty,
    leverage: lev,
    margin,
    riskActual: notional * distPct + notional * 2 * fee,
    feeCost: notional * 2 * fee,
    liqDist,
    liqWarning,
    valuePerUnit: qty, // $ P&L per 1.0 price move
  };
}

/** Per-target stats. size is lots (kind lots) or qty in coins (kind usdt). */
export function targetStats({ direction, entry, sl, tps, size, valuePerUnitPerSize, riskActual }) {
  const dir = direction === 'short' ? -1 : 1;
  const risk1R = Math.abs(entry - sl);
  return (tps || []).map((tp, i) => {
    const move = (tp - entry) * dir;
    const profit = move * valuePerUnitPerSize * size;
    return {
      label: `TP${i + 1}`,
      price: tp,
      move,
      r: risk1R > 0 ? move / risk1R : null,
      profit,
      pct: entry ? move / entry : null,
      valid: move > 0,
    };
  });
}

/** Full sizing: picks lots or usdt based on kind and returns a unified result. */
export function sizeTrade(input) {
  const { kind, direction, entry, sl, tps = [], risk } = input;
  if (!(entry > 0) || !(sl > 0) || !(risk > 0)) return null;
  if (direction === 'long' && sl >= entry) return { error: 'SL must be below entry for a BUY' };
  if (direction === 'short' && sl <= entry) return { error: 'SL must be above entry for a SELL' };
  let core;
  if (kind === 'lots') {
    core = sizeLots(input);
    if (!core) return null;
    core.size = core.lots;
    core.perUnit = core.valuePerUnit; // $ per 1.0 move per lot
  } else {
    core = sizeUsdt(input);
    if (!core) return null;
    core.size = core.qty;
    core.perUnit = 1; // $ per 1.0 move per coin
  }
  const rr = Math.abs(entry - sl);
  core.risk1R = rr;
  core.riskPct = rr / entry;
  core.targets = targetStats({ direction, entry, sl, tps, size: core.size, valuePerUnitPerSize: core.perUnit, riskActual: core.riskActual });
  core.direction = direction;
  core.entry = entry;
  core.sl = sl;
  return core;
}
