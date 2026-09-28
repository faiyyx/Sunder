// Number formatting helpers.

export function decimalsOf(n) {
  if (n == null || !Number.isFinite(n)) return 0;
  const s = String(n);
  if (s.includes('e-')) return Math.min(12, parseInt(s.split('e-')[1], 10) + (s.split('e-')[0].split('.')[1] || '').length);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/** Decimals to display for a price, based on the magnitude and the precision seen in inputs. */
export function priceDecimals(price, refs = []) {
  const seen = Math.max(0, ...refs.filter((r) => r != null).map(decimalsOf));
  let base;
  const p = Math.abs(price || 0);
  if (p === 0) base = 2;
  else if (p >= 1000) base = 2;
  else if (p >= 10) base = 2;
  else if (p >= 1) base = 3;
  else if (p >= 0.1) base = 4;
  else if (p >= 0.01) base = 5;
  else if (p >= 0.001) base = 6;
  else base = Math.min(10, 2 - Math.floor(Math.log10(p)));
  return Math.min(10, Math.max(base, seen));
}

export function fmtPrice(x, refs = []) {
  if (x == null || !Number.isFinite(x)) return '—';
  const d = priceDecimals(x, refs);
  const s = trimZeros(x.toFixed(d), Math.min(d, 2));
  if (Math.abs(x) < 10000) return s;
  const [ip, fp] = s.split('.');
  return Number(ip).toLocaleString('en-US') + (fp ? `.${fp}` : '');
}

function trimZeros(s, keep) {
  if (!s.includes('.')) return s;
  let [a, b] = s.split('.');
  b = b.replace(/0+$/, '');
  if (b.length < keep) b = b.padEnd(keep, '0');
  return b.length ? `${a}.${b}` : a;
}

export function fmtMoney(x, sym = '$', decimals = 2) {
  if (x == null || !Number.isFinite(x)) return '—';
  const sign = x < 0 ? '-' : '';
  const v = Math.abs(x);
  const d = v >= 1000 ? Math.min(decimals, 0) : decimals;
  return `${sign}${sym}${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function fmtSigned(x, sym = '$') {
  if (x == null || !Number.isFinite(x)) return '—';
  const s = fmtMoney(Math.abs(x), sym);
  return x > 0 ? `+${s}` : x < 0 ? `-${s}` : s;
}

export function fmtLots(x, step = 0.01) {
  if (x == null || !Number.isFinite(x)) return '—';
  const d = Math.max(2, decimalsOf(step));
  return x.toFixed(d);
}

export function fmtQty(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a === 0) return '0';
  let d;
  if (a >= 1000) d = 2;
  else if (a >= 100) d = 3;
  else if (a >= 1) d = 4;
  else d = Math.min(10, 4 - Math.floor(Math.log10(a)));
  const fixed = trimZeros(a.toFixed(d), 0);
  const [ip, fp] = fixed.split('.');
  return (x < 0 ? '-' : '') + Number(ip).toLocaleString('en-US') + (fp ? `.${fp}` : '');
}

export function fmtPct(x, d = 2) {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(d)}%`;
}

export function fmtR(r) {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${r >= 0 ? '' : '-'}${Math.abs(r).toFixed(2)}R`;
}

export function fmtInt(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  return Math.round(x).toLocaleString('en-US');
}
