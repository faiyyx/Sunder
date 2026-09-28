// Live prices. Tries several public sources per instrument and uses the first one that
// actually delivers a price. Sources marked `approx` track the real market closely but
// are not the same quote your broker shows (e.g. tokenised gold for XAUUSD).

const state = { online: typeof navigator === 'undefined' ? true : navigator.onLine };
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { state.online = true; for (const w of registry.values()) w.restart(); });
  window.addEventListener('offline', () => { state.online = false; for (const w of registry.values()) w.setOffline(); });
}

/* ------------------------------------------------------------------ symbol mapping */
const FX = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

/** Which feeds can quote this instrument, in order of preference. Pure; unit-tested. */
export function sourcesFor(instrument, opts = {}) {
  if (!instrument || !instrument.symbol) return [];
  const sym = instrument.symbol.toUpperCase();
  const out = [];
  const finnhub = (s) => { if (opts.finnhubKey) out.push({ id: 'finnhub', label: 'Finnhub (OANDA)', symbol: s, kind: 'ws' }); };
  if (instrument.kind === 'usdt') {
    const base = (instrument.base || sym.replace(/(USDT|USDC|USD|PERP)$/, '')).toUpperCase();
    const perpOnly = /^\d+/.test(base);
    if (!perpOnly) out.push({ id: 'binance', label: 'Binance', symbol: `${base}USDT`, kind: 'ws' });
    out.push({ id: 'binance-futures', label: 'Binance Futures', symbol: `${base}USDT`, kind: 'ws' });
    out.push({ id: 'bybit', label: 'Bybit', symbol: `${base}USDT`, kind: 'ws' });
    out.push({ id: 'okx', label: 'OKX', symbol: `${base}-USDT`, kind: 'rest' });
    out.push({ id: 'coinbase', label: 'Coinbase', symbol: `${base}-USD`, kind: 'rest' });
    out.push({ id: 'mexc', label: 'MEXC', symbol: `${base}USDT`, kind: 'rest' });
    return out;
  }
  if (sym === 'XAUUSD' || sym === 'XAGUSD' || sym === 'XPTUSD') {
    const metal = sym.slice(0, 3);
    finnhub(`OANDA:${metal}_USD`);
    out.push({ id: 'swissquote', label: 'Swissquote', symbol: `${metal}/USD`, kind: 'rest' });
    out.push({ id: 'goldapi', label: 'gold-api.com', symbol: metal, kind: 'rest' });
    if (opts.allowApprox !== false && sym === 'XAUUSD') {
      out.push({ id: 'binance', label: 'Binance PAXG ≈ gold', symbol: 'PAXGUSDT', kind: 'ws', approx: true });
      out.push({ id: 'okx', label: 'OKX XAUT ≈ gold', symbol: 'XAUT-USDT', kind: 'rest', approx: true });
      out.push({ id: 'bitfinex', label: 'Bitfinex XAUT ≈ gold', symbol: 'tXAUTUSD', kind: 'rest', approx: true });
    }
    return out;
  }
  const fx = sym.match(/^([A-Z]{3})([A-Z]{3})$/);
  if (fx && FX.includes(fx[1]) && FX.includes(fx[2])) {
    finnhub(`OANDA:${fx[1]}_${fx[2]}`);
    out.push({ id: 'swissquote', label: 'Swissquote', symbol: `${fx[1]}/${fx[2]}`, kind: 'rest' });
    return out;
  }
  if (sym === 'USOIL') { finnhub('OANDA:WTICO_USD'); return out; }
  if (sym === 'UKOIL') { finnhub('OANDA:BCO_USD'); return out; }
  return out; // indices etc.: no free live source
}

/* ------------------------------------------------------------------ transports */
function num(x) { const v = typeof x === 'string' ? parseFloat(x) : x; return Number.isFinite(v) && v > 0 ? v : null; }

function wsFeed({ url, subscribe, parse }, onPrice, onFail) {
  let ws; let gotPrice = false; let closed = false;
  const timer = setTimeout(() => { if (!gotPrice) fail(new Error('timeout')); }, 8000);
  function fail(err) { if (closed) return; closed = true; clearTimeout(timer); try { ws && ws.close(); } catch { /* ignore */ } onFail(err); }
  try {
    ws = new WebSocket(url);
  } catch (e) { fail(e); return () => {}; }
  ws.onopen = () => { if (subscribe) ws.send(JSON.stringify(subscribe)); };
  ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    const p = parse(msg);
    if (p != null) { gotPrice = true; clearTimeout(timer); onPrice(p, Date.now()); }
  };
  ws.onerror = () => { if (!gotPrice) fail(new Error('ws error')); };
  ws.onclose = () => { if (!closed) { closed = true; clearTimeout(timer); onFail(new Error(gotPrice ? 'ws closed' : 'ws refused')); } };
  return () => { closed = true; clearTimeout(timer); try { ws.close(); } catch { /* ignore */ } };
}

function restFeed({ url, extract, interval = 1000 }, onPrice, onFail) {
  let stopped = false; let gotPrice = false; let failures = 0; let timer = null; let ctrl = null;
  async function tick() {
    if (stopped) return;
    ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const p = num(extract(await r.json()));
      if (p == null) throw new Error('no price');
      gotPrice = true; failures = 0;
      if (!stopped) onPrice(p, Date.now());
    } catch (e) {
      failures++;
      if (!gotPrice || failures >= 5) { if (!stopped) { stopped = true; clearTimeout(t); onFail(e); } return; }
    } finally { clearTimeout(t); }
    if (!stopped) timer = setTimeout(tick, interval);
  }
  tick();
  return () => { stopped = true; clearTimeout(timer); try { ctrl && ctrl.abort(); } catch { /* ignore */ } };
}

/* ------------------------------------------------------------------ providers */
const PROVIDERS = {
  binance: (s, key) => ({ ws: { url: `wss://stream.binance.com:9443/ws/${s.toLowerCase()}@miniTicker`, parse: (m) => num(m && m.c) },
    rest: { url: `https://api.binance.com/api/v3/ticker/price?symbol=${s}`, extract: (j) => j && j.price } }),
  'binance-futures': (s) => ({ ws: { url: `wss://fstream.binance.com/ws/${s.toLowerCase()}@miniTicker`, parse: (m) => num(m && m.c) },
    rest: { url: `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${s}`, extract: (j) => j && j.price } }),
  bybit: (s) => ({ ws: { url: 'wss://stream.bybit.com/v5/public/linear', subscribe: { op: 'subscribe', args: [`tickers.${s}`] }, parse: (m) => num(m && m.data && m.data.lastPrice) },
    rest: { url: `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${s}`, extract: (j) => j && j.result && j.result.list && j.result.list[0] && j.result.list[0].lastPrice } }),
  okx: (s) => ({ rest: { url: `https://www.okx.com/api/v5/market/ticker?instId=${s}`, extract: (j) => j && j.data && j.data[0] && j.data[0].last } }),
  coinbase: (s) => ({ rest: { url: `https://api.exchange.coinbase.com/products/${s}/ticker`, extract: (j) => j && j.price } }),
  mexc: (s) => ({ rest: { url: `https://api.mexc.com/api/v3/ticker/price?symbol=${s}`, extract: (j) => j && j.price } }),
  bitfinex: (s) => ({ rest: { url: `https://api-pub.bitfinex.com/v2/ticker/${s}`, extract: (j) => Array.isArray(j) ? j[6] : null } }),
  swissquote: (s) => ({ rest: { url: `https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/${s}`, interval: 1500,
    extract: (j) => { const q = Array.isArray(j) && j[0] && j[0].spreadProfilePrices && j[0].spreadProfilePrices[0]; return q ? (num(q.bid) + num(q.ask)) / 2 : null; } } }),
  goldapi: (s) => ({ rest: { url: `https://api.gold-api.com/price/${s}`, interval: 1500, extract: (j) => j && j.price } }),
  finnhub: (s, key) => ({ ws: { url: `wss://ws.finnhub.io?token=${encodeURIComponent(key)}`, subscribe: { type: 'subscribe', symbol: s },
    parse: (m) => (m && m.type === 'trade' && m.data && m.data.length ? num(m.data[m.data.length - 1].p) : null) },
    rest: { url: `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(key)}`, interval: 1000, extract: (j) => j && j.c } }),
};

/* ------------------------------------------------------------------ watcher */
const registry = new Map();

class Watcher {
  constructor(instrument, opts) {
    this.instrument = instrument;
    this.opts = opts;
    this.listeners = new Set();
    this.sources = sourcesFor(instrument, opts);
    this.index = 0;
    this.attempt = 0;
    this.stop = null;
    this.retryTimer = null;
    this.status = 'idle';
    this.current = null;
    this.last = null;
  }
  emit(ev) { for (const l of this.listeners) { try { l(ev); } catch (e) { console.error(e); } } }
  setStatus(status, extra = {}) { this.status = status; this.emit({ type: 'status', status, source: this.current ? this.current.label : null, ...extra }); }
  halt() { this.attempt++; clearTimeout(this.retryTimer); if (this.stop) { const f = this.stop; this.stop = null; try { f(); } catch { /* ignore */ } } }
  setOffline() { this.halt(); this.setStatus('offline'); }
  restart() { this.halt(); this.index = 0; this.start(); }
  next() { this.halt(); this.index++; this.retryTimer = setTimeout(() => this.start(), 250); }
  start() {
    if (!state.online) { this.setStatus('offline'); return; }
    if (!this.sources.length) { this.current = null; this.setStatus('unavailable', { reason: 'no free live source for this market' }); return; }
    if (this.index >= this.sources.length) {
      this.current = null;
      this.setStatus('unavailable', { reason: 'no source reachable' });
      this.retryTimer = setTimeout(() => { this.index = 0; this.start(); }, 30000);
      return;
    }
    const src = this.sources[this.index];
    this.current = src;
    const def = PROVIDERS[src.id](src.symbol, this.opts.finnhubKey);
    this.setStatus('connecting');
    const onPrice = (price, ts) => {
      this.last = { price, ts, source: src.label, approx: !!src.approx };
      if (this.status !== 'live') this.setStatus('live', { approx: !!src.approx });
      this.emit({ type: 'price', price, ts, source: src.label, approx: !!src.approx });
    };
    const useRest = () => {
      this.halt();
      const a = this.attempt;
      const stop = restFeed(def.rest, (p, ts) => { if (a === this.attempt) onPrice(p, ts); }, () => { if (a === this.attempt) this.next(); });
      if (a === this.attempt) this.stop = stop; else stop();
    };
    const a = this.attempt;
    if (def.ws && typeof WebSocket !== 'undefined') {
      const stop = wsFeed(def.ws, (p, ts) => { if (a === this.attempt) onPrice(p, ts); }, () => { if (a !== this.attempt) return; if (def.rest) useRest(); else this.next(); });
      if (a === this.attempt) this.stop = stop; else stop();
    } else if (def.rest) {
      useRest();
    } else {
      this.next();
    }
  }
}

/**
 * Subscribe to live prices for an instrument. Returns an unsubscribe function.
 * listener receives { type: 'price', price, ts, source, approx } and { type: 'status', status, source, reason }.
 * Subscriptions for the same symbol share one connection.
 */
export function watchPrice(instrument, listener, opts = {}) {
  if (!instrument || !instrument.symbol) return () => {};
  const key = `${instrument.symbol}|${opts.finnhubKey ? 'k' : ''}|${opts.allowApprox === false ? 'x' : ''}`;
  let w = registry.get(key);
  if (!w) { w = new Watcher(instrument, opts); registry.set(key, w); w.start(); }
  w.listeners.add(listener);
  if (w.last) listener({ type: 'price', ...w.last });
  else listener({ type: 'status', status: w.status, source: w.current ? w.current.label : null });
  return () => {
    w.listeners.delete(listener);
    if (!w.listeners.size) { w.halt(); registry.delete(key); }
  };
}

export function stopAllPrices() { for (const [k, w] of registry) { w.halt(); registry.delete(k); } }
export function liveSourceLabels(instrument, opts = {}) { return sourcesFor(instrument, opts).map((s) => s.label); }
