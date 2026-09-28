// Instrument detection and per-instrument defaults.
// kind: 'lots'  -> sized in lots (gold, silver, forex, indices, oil, CFDs)
//       'usdt'  -> sized in quote currency notional (crypto spot / USDT-margined perps)

const LOTS = (symbol, name, contractSize, decimals, quote = 'USD', base = null, note = '') => ({
  symbol, name, kind: 'lots', contractSize, decimals, quote, base, note,
});

// Known lot-based instruments. contractSize = units per 1.00 standard lot.
// P&L per lot for a 1.00 price move = contractSize (in quote currency).
export const LOT_INSTRUMENTS = {
  XAUUSD: LOTS('XAUUSD', 'Gold', 100, 2, 'USD', 'XAU', '1 lot = 100 oz. $1 move = $100 per lot.'),
  XAGUSD: LOTS('XAGUSD', 'Silver', 5000, 3, 'USD', 'XAG', '1 lot = 5,000 oz.'),
  XPTUSD: LOTS('XPTUSD', 'Platinum', 100, 2, 'USD', 'XPT', '1 lot = 100 oz.'),
  EURUSD: LOTS('EURUSD', 'EUR/USD', 100000, 5, 'USD', 'EUR'),
  GBPUSD: LOTS('GBPUSD', 'GBP/USD', 100000, 5, 'USD', 'GBP'),
  AUDUSD: LOTS('AUDUSD', 'AUD/USD', 100000, 5, 'USD', 'AUD'),
  NZDUSD: LOTS('NZDUSD', 'NZD/USD', 100000, 5, 'USD', 'NZD'),
  USDJPY: LOTS('USDJPY', 'USD/JPY', 100000, 3, 'JPY', 'USD'),
  USDCAD: LOTS('USDCAD', 'USD/CAD', 100000, 5, 'CAD', 'USD'),
  USDCHF: LOTS('USDCHF', 'USD/CHF', 100000, 5, 'CHF', 'USD'),
  EURJPY: LOTS('EURJPY', 'EUR/JPY', 100000, 3, 'JPY', 'EUR'),
  GBPJPY: LOTS('GBPJPY', 'GBP/JPY', 100000, 3, 'JPY', 'GBP'),
  EURGBP: LOTS('EURGBP', 'EUR/GBP', 100000, 5, 'GBP', 'EUR'),
  AUDJPY: LOTS('AUDJPY', 'AUD/JPY', 100000, 3, 'JPY', 'AUD'),
  CADJPY: LOTS('CADJPY', 'CAD/JPY', 100000, 3, 'JPY', 'CAD'),
  CHFJPY: LOTS('CHFJPY', 'CHF/JPY', 100000, 3, 'JPY', 'CHF'),
  NZDJPY: LOTS('NZDJPY', 'NZD/JPY', 100000, 3, 'JPY', 'NZD'),
  EURAUD: LOTS('EURAUD', 'EUR/AUD', 100000, 5, 'AUD', 'EUR'),
  EURCAD: LOTS('EURCAD', 'EUR/CAD', 100000, 5, 'CAD', 'EUR'),
  EURCHF: LOTS('EURCHF', 'EUR/CHF', 100000, 5, 'CHF', 'EUR'),
  GBPAUD: LOTS('GBPAUD', 'GBP/AUD', 100000, 5, 'AUD', 'GBP'),
  GBPCAD: LOTS('GBPCAD', 'GBP/CAD', 100000, 5, 'CAD', 'GBP'),
  GBPCHF: LOTS('GBPCHF', 'GBP/CHF', 100000, 5, 'CHF', 'GBP'),
  AUDCAD: LOTS('AUDCAD', 'AUD/CAD', 100000, 5, 'CAD', 'AUD'),
  AUDNZD: LOTS('AUDNZD', 'AUD/NZD', 100000, 5, 'NZD', 'AUD'),
  US30: LOTS('US30', 'Dow Jones (US30)', 1, 1, 'USD', null, 'Contract size varies by broker; $1 per point per lot is common.'),
  NAS100: LOTS('NAS100', 'Nasdaq 100', 1, 1, 'USD', null, 'Contract size varies by broker; $1 per point per lot is common.'),
  SPX500: LOTS('SPX500', 'S&P 500', 1, 1, 'USD', null, 'Contract size varies by broker.'),
  GER40: LOTS('GER40', 'DAX 40', 1, 1, 'EUR', null, 'Quoted in EUR; contract size varies by broker.'),
  UK100: LOTS('UK100', 'FTSE 100', 1, 1, 'GBP', null, 'Quoted in GBP; contract size varies by broker.'),
  JP225: LOTS('JP225', 'Nikkei 225', 1, 0, 'JPY', null, 'Quoted in JPY; contract size varies by broker.'),
  USOIL: LOTS('USOIL', 'WTI Crude', 1000, 2, 'USD', null, '1 lot = 1,000 barrels on most brokers (some use 100). Check yours.'),
  UKOIL: LOTS('UKOIL', 'Brent Crude', 1000, 2, 'USD', null, '1 lot = 1,000 barrels on most brokers (some use 100). Check yours.'),
};

// Alias -> canonical symbol. Longest aliases are matched first.
const LOT_ALIASES = [
  ['XAUUSD', 'XAUUSD'], ['XAU/USD', 'XAUUSD'], ['XAU USD', 'XAUUSD'], ['GOLD/USD', 'XAUUSD'], ['GOLDUSD', 'XAUUSD'], ['GOLD', 'XAUUSD'], ['XAU', 'XAUUSD'],
  ['XAGUSD', 'XAGUSD'], ['XAG/USD', 'XAGUSD'], ['SILVER', 'XAGUSD'], ['XAG', 'XAGUSD'],
  ['XPTUSD', 'XPTUSD'], ['XPT/USD', 'XPTUSD'], ['PLATINUM', 'XPTUSD'],
  ['US30', 'US30'], ['DJ30', 'US30'], ['DJI30', 'US30'], ['DOW JONES', 'US30'], ['DOW', 'US30'], ['WS30', 'US30'], ['DJIA', 'US30'],
  ['NAS100', 'NAS100'], ['USTEC', 'NAS100'], ['US100', 'NAS100'], ['NDX100', 'NAS100'], ['NASDAQ', 'NAS100'], ['NDX', 'NAS100'], ['USTECH', 'NAS100'], ['NQ100', 'NAS100'],
  ['SPX500', 'SPX500'], ['US500', 'SPX500'], ['SP500', 'SPX500'], ['S&P500', 'SPX500'], ['S&P 500', 'SPX500'], ['SPX', 'SPX500'],
  ['GER40', 'GER40'], ['GER30', 'GER40'], ['DE40', 'GER40'], ['DE30', 'GER40'], ['DAX40', 'GER40'], ['DAX', 'GER40'],
  ['UK100', 'UK100'], ['FTSE100', 'UK100'], ['FTSE', 'UK100'],
  ['JP225', 'JP225'], ['JPN225', 'JP225'], ['NIKKEI', 'JP225'], ['NIK225', 'JP225'],
  ['USOIL', 'USOIL'], ['XTIUSD', 'USOIL'], ['XTI/USD', 'USOIL'], ['WTI', 'USOIL'], ['CRUDE OIL', 'USOIL'], ['CRUDE', 'USOIL'], ['OIL', 'USOIL'], ['USOUSD', 'USOIL'],
  ['UKOIL', 'UKOIL'], ['XBRUSD', 'UKOIL'], ['XBR/USD', 'UKOIL'], ['BRENT', 'UKOIL'],
].sort((a, b) => b[0].length - a[0].length);

const FX_CCY = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY'];

// A reasonably broad list of crypto tickers that may appear without a quote suffix.
export const CRYPTO_TICKERS = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'MATIC', 'POL', 'LTC', 'TRX', 'SHIB', 'PEPE', 'SUI', 'APT', 'ARB', 'OP',
  'NEAR', 'ATOM', 'UNI', 'INJ', 'TIA', 'SEI', 'WIF', 'BONK', 'FET', 'RENDER', 'RNDR', 'TON', 'FIL', 'ICP', 'HBAR', 'XLM', 'ETC', 'BCH', 'AAVE', 'MKR',
  'LDO', 'ENA', 'ONDO', 'JUP', 'PYTH', 'STRK', 'ZK', 'ORDI', 'FLOKI', 'GALA', 'SAND', 'MANA', 'AXS', 'IMX', 'GRT', 'RUNE', 'CRV', 'DYDX', 'GMX',
  'STX', 'ALGO', 'VET', 'EOS', 'XTZ', 'EGLD', 'THETA', 'FTM', 'S', 'KAS', 'TAO', 'AR', 'FLOW', 'CFX', 'MINA', 'ROSE', 'CHZ', 'ENJ', 'ZIL', 'ONE',
  'NEO', 'IOTA', 'KSM', 'COMP', 'SNX', 'SUSHI', '1INCH', 'YFI', 'BAL', 'ZRX', 'BAT', 'LRC', 'CELO', 'KAVA', 'WLD', 'PENDLE', 'NOT', 'DOGS', 'HMSTR',
  'POPCAT', 'NEIRO', 'MOODENG', 'GOAT', 'PNUT', 'ACT', 'TRUMP', 'MELANIA', 'BERA', 'IP', 'KAITO', 'LAYER', 'VIRTUAL', 'AI16Z', 'FARTCOIN', 'HYPE',
  'ENS', 'APE', 'BLUR', 'CAKE', 'TWT', 'JASMY', 'ANKR', 'RSR', 'SKL', 'OCEAN', 'AGIX', 'ARKM', 'CYBER', 'BIGTIME', 'MEME', 'ORCA', 'RAY', 'JTO',
  'W', 'ZRO', 'BLAST', 'EIGEN', 'ETHFI', 'REZ', 'OMNI', 'SAGA', 'ALT', 'MANTA', 'DYM', 'PIXEL', 'PORTAL', 'AEVO', 'BOME', 'MEW', 'BRETT', 'MOG',
  'TURBO', 'PEOPLE', 'LUNA', 'LUNC', 'USTC', 'XMR', 'ZEC', 'DASH', 'QNT', 'OM', 'PLUME', 'MOVE', 'ME', 'PENGU', 'VANA', 'USUAL', 'VELO',
  '1000PEPE', '1000SHIB', '1000BONK', '1000FLOKI', '1000SATS', '1000RATS', '1000LUNC', '1000XEC', '1000CAT', '1MBABYDOGE',
]);

const CRYPTO_QUOTES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USD', 'PERP'];

/**
 * Detect the instrument mentioned in a signal text.
 * Returns { symbol, name, kind, contractSize, decimals, quote, base, matched, note } or null.
 */
export function detectInstrument(rawText) {
  const text = String(rawText || '').toUpperCase();
  const hits = [];

  // 1) Crypto with an explicit quote suffix: BTCUSDT, BTC/USDT, BTC-USDT, ETHUSDT.P, SOLUSDTPERP, BTC USDT
  const cq = /(?<![A-Z0-9])([A-Z0-9]{2,12}?)\s?[\/\-_.]?\s?(USDT|USDC|BUSD|FDUSD|TUSD|PERP)(?:\.P|PERP|\.PERP|-PERP)?(?![A-Z])/g;
  let m;
  while ((m = cq.exec(text))) {
    const base = m[1];
    if (base === 'USD' || CRYPTO_QUOTES.includes(base)) continue;
    if (FX_CCY.includes(base) || base === 'XAU' || base === 'XAG') continue;
    if (/^\d+$/.test(base)) continue;
    hits.push({ index: m.index, pri: 3, inst: cryptoInstrument(base, m[2] === 'PERP' ? 'USDT' : m[2]), matched: m[0].trim() });
  }

  // 2) Lot-based aliases (gold, silver, indices, oil)
  for (const [alias, sym] of LOT_ALIASES) {
    const re = new RegExp(`(?<![A-Z0-9])${escapeRe(alias)}(?![A-Z0-9])`, 'g');
    while ((m = re.exec(text))) {
      // "XAUUSD.m" / "XAUUSDm" broker suffixes are fine (non-alnum boundary or lowercase suffix ate by toUpperCase; accept)
      hits.push({ index: m.index, pri: alias.length >= 5 ? 3 : 2, inst: { ...LOT_INSTRUMENTS[sym] }, matched: m[0] });
    }
  }
  // broker-suffixed gold like XAUUSDM, XAUUSD.M, XAUUSD+, XAUUSD_I
  const goldSuffix = /(?<![A-Z0-9])XAUUSD[A-Z0-9._+-]{1,3}(?![A-Z0-9])/g;
  while ((m = goldSuffix.exec(text))) hits.push({ index: m.index, pri: 3, inst: { ...LOT_INSTRUMENTS.XAUUSD }, matched: m[0] });

  // 3) Forex pairs: EURUSD, EUR/USD, EUR USD
  const fx = new RegExp(`(?<![A-Z0-9])(${FX_CCY.join('|')})\\s?/?\\s?(${FX_CCY.join('|')})(?![A-Z0-9])`, 'g');
  while ((m = fx.exec(text))) {
    if (m[1] === m[2]) continue;
    const sym = m[1] + m[2];
    const known = LOT_INSTRUMENTS[sym];
    const inst = known ? { ...known } : LOTS(sym, `${m[1]}/${m[2]}`, 100000, m[2] === 'JPY' ? 3 : 5, m[2], m[1]);
    hits.push({ index: m.index, pri: 3, inst, matched: m[0] });
  }

  // 4) Crypto with USD suffix (BTCUSD, ETH/USD) - treated as crypto (USDT sizing) unless it is FX/metal.
  const cu = /(?<![A-Z0-9])([A-Z0-9]{2,12}?)\s?[\/\-_.]?\s?USD(?:\.P)?(?![A-Z0-9])/g;
  while ((m = cu.exec(text))) {
    const base = m[1];
    if (FX_CCY.includes(base) || base === 'XAU' || base === 'XAG' || base === 'XPT' || base === 'XTI' || base === 'XBR' || base === 'USO') continue;
    if (!CRYPTO_TICKERS.has(base) && !/^[A-Z]{3,5}$/.test(base)) continue;
    hits.push({ index: m.index, pri: CRYPTO_TICKERS.has(base) ? 3 : 1, inst: cryptoInstrument(base, 'USD'), matched: m[0].trim() });
  }

  // 5) Hash/dollar-tagged or bare crypto tickers: #BTC, $SOL, "ETH LONG"
  const bare = /(?<![A-Z0-9])[#$]?([A-Z0-9]{2,12})(?![A-Z0-9])/g;
  while ((m = bare.exec(text))) {
    const t = m[1];
    if (!CRYPTO_TICKERS.has(t)) continue;
    const tagged = m[0].startsWith('#') || m[0].startsWith('$');
    hits.push({ index: m.index, pri: tagged ? 2 : 1, inst: cryptoInstrument(t, 'USDT'), matched: m[0] });
  }

  if (!hits.length) return null;
  // Highest priority wins; ties -> earliest in text (signals usually name the pair first).
  hits.sort((a, b) => (b.pri - a.pri) || (a.index - b.index));
  const best = hits[0];
  return { ...best.inst, matched: best.matched };
}

export function cryptoInstrument(base, quote = 'USDT') {
  return {
    symbol: `${base}${quote}`,
    name: `${base}/${quote}`,
    kind: 'usdt',
    contractSize: 1,
    decimals: null,
    quote,
    base,
    note: '',
  };
}

/** Look up defaults for a symbol typed by hand. */
export function instrumentForSymbol(symbolRaw) {
  const s = String(symbolRaw || '').trim();
  if (!s) return null;
  return detectInstrument(s) || (
    /^[A-Z0-9]{2,12}$/i.test(s)
      ? cryptoInstrument(s.toUpperCase().replace(/(USDT|USDC|USD)$/, ''), (s.toUpperCase().match(/(USDT|USDC|USD)$/) || ['USDT'])[0])
      : null
  );
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
