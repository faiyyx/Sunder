// Signal parser: turns free-form signal text (typed, pasted, or OCR'd) into structured fields.
import { detectInstrument } from './instruments.js';

const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:[.,]\d+)?|\.\d+`;

// Keyword boundaries: letters only, so "SL2640" and "TP1:2660" still split correctly.
const B = String.raw`(?<![A-Z])`;
const E = String.raw`(?![A-Z])`;

const TOKEN_RE = new RegExp([
  // direction, swallowing order-type words so "SELL STOP" is not read as a stop loss
  String.raw`(?<dir>${B}(?:BUY|SELL|LONG|SHORT)${E}(?!\s*TERM)(?:\s+(?:LIMIT|STOP|NOW|MARKET|ORDER|ZONE|AREA|SETUP|SIGNAL|HERE|IT|THE\s+DIP))*)`,
  // reset words: numbers after these are not prices
  String.raw`(?<reset>${B}(?:RATIO|RR|R:R|R/R|REWARD|PROFITS?|P&L|PNL|LOTS?|VOLUME|VOL|QTY|QUANTITY|AMOUNT|SIZE|MARGIN|BALANCE|EQUITY|ACCOUNT|COMMISSION|FEES?|SPREAD|TIMEFRAME|TF|CHART|DATE|TIME|PIPS?|POINTS?|PTS)${E})`,
  // market entry
  String.raw`(?<market>${B}(?:CMP|MARKET\s*PRICE|AT\s*MARKET|MARKET|NOW|CURRENT\s*PRICE)${E})`,
  // strong entry keywords (optional index for DCA entries: ENTRY 1 / ENTRY 2)
  String.raw`(?<entry>${B}(?:ENTRIES|ENTRY(?:\s*(?:PRICE|ZONE|AREA|POINT|LEVEL|RANGE|AT))?|ENTER(?:\s*AT)?|EP|E\.P\.?|BUY\s*ZONE|SELL\s*ZONE|BUYING\s*ZONE|SELLING\s*ZONE|OPEN(?:ING)?\s*PRICE)${E}\s*(?<entryidx>\d(?![\d.,%KX]))?)`,
  // weak entry keywords: only apply when we are not inside SL / TP context
  String.raw`(?<wentry>${B}(?:PRICE|OPEN)${E}|@)`,
  // stop loss
  String.raw`(?<sl>${B}(?:STOP[\s-]*LOSS|STOPLOSS|SL|5L|S\.L\.?|S/L|STOP|STP|STOPS)${E})`,
  // take profit with optional index
  String.raw`(?<tp>${B}(?:TAKE[\s-]*PROFITS?|TAKEPROFIT|TPS?|T\.P\.?|TARGETS?|TGTS?|TARGET\s*PRICE|GOALS?)${E}\s*(?<tpidx>\d(?![\d.,%KX]))?|${B}T(?<tpidx2>\d)(?![\d.,A-Z]))`,
  // leverage
  String.raw`(?<lev>${B}(?:LEV(?:ERAGE)?|CROSS|ISOLATED)${E}\s*[:=]?\s*(?<levn>\d{1,3})\s*[X×]?${E}|(?<![A-Z0-9.])(?<levn2>\d{1,3})\s?[X×]${E}|${B}[X×](?<levn3>\d{1,3})(?![\d.,A-Z]))`,
  // risk hint: RISK 1%  /  RISK $50
  String.raw`(?<risk>${B}RISK${E}\s*[:=]?\s*\$?\s*(?<riskn>\d+(?:\.\d+)?)\s*(?<riskunit>%|\$|USD|USDT)?)`,
  // percentage value (used for SL 3% / TP 5%; ignored elsewhere)
  String.raw`(?<pct>(?<pctn>\d+(?:\.\d+)?)\s*%)`,
  // noise numbers to skip
  String.raw`(?<noise>` + [
    String.raw`\(\s*[+-]\s*\d[^)]*\)`, // (+30) (-1.2%)
    String.raw`(?<![\d.,])\d{1,3}\s?(?:H|HR|HRS|HOURS?|MIN|MINS|MINUTES?|M|D|DAYS?|W|WEEKS?)${E}`, // 4H 15MIN 15M 1D
    String.raw`${B}[MHDW]\d{1,3}(?![\d.,A-Z])`, // M15 H4 D1
    String.raw`(?<![\d.,])\d{1,2}(?:ST|ND|RD|TH)${E}`, // 1ST 2ND
    String.raw`(?<![\d.,])\d{1,2}(?:\.\d{1,2})?\s*:\s*\d{1,2}(?:\.\d{1,2})?(?![\d.,:])`, // 1:3 ratios
    String.raw`(?<![\d.,])\d{1,3}(?:\.\d+)?\s*(?:PIPS?|PTS?|POINTS?)${E}`, // 30 pips
    String.raw`(?<![\d.,])\d{4}-\d{2}-\d{2}(?![\d])`, // ISO date
    String.raw`(?<![\d.,])\d{1,2}[./]\d{1,2}[./]\d{2,4}(?![\d])`, // 12/05/2024
  ].join('|') + `)`,
  // range: two numbers joined by - / to ~
  String.raw`(?<range>(?<r1>${NUM})(?<rk>K)?\s*(?:-+|TO|~|/|→|>)\s*(?<r2>${NUM})(?<rk2>K)?)`,
  // plain number
  String.raw`(?<num>(?<n>${NUM})(?<nk>K)?(?![\d]))`,
].join('|'), 'g');

const DASHES = /[‐-―−﹘﹣－]/g;

const LONG_EMOJI = /[🟢🔵📈🚀⬆️🔼↗️🐂]/gu;
const SHORT_EMOJI = /[🔴📉⬇️🔽↘️🐻]/gu;

/** Normalize unicode, fix common OCR digit confusions, map semantic emojis to keywords. */
export function normalizeText(raw) {
  let t = String(raw || '');
  t = t.replace(/\r\n?/g, '\n');
  t = t.replace(/[  -​  　]/g, ' ');
  t = t.replace(DASHES, '-');
  t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48));
  t = t.replace(/[٠-٩]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48));
  t = t.replace(/[۰-۹]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06F0 + 48));
  t = t.replace(/[，٫٬]/g, ',').replace(/[．。]/g, '.').replace(/：/g, ':').replace(/[＃]/g, '#').replace(/[＄]/g, '$');
  t = t.replace(/[0-9#*]️?⃣/g, ' '); // keycap digits 1️⃣
  t = t.replace(/https?:\/\/\S+/gi, ' ');

  const longHits = (t.match(LONG_EMOJI) || []).length;
  const shortHits = (t.match(SHORT_EMOJI) || []).length;
  let emojiDir = null;
  if (longHits && !shortHits) emojiDir = 'long';
  else if (shortHits && !longHits) emojiDir = 'short';

  t = t.replace(/🎯/gu, ' TP ').replace(/[🛑⛔]/gu, ' SL ').replace(/[✅☑️✔️]/gu, ' ');
  t = t.replace(/[\p{Extended_Pictographic}️‍]/gu, ' ');

  // OCR repair: inside digit-heavy runs, map look-alike letters to digits.
  t = t.replace(/(?<![A-Za-z])[0-9OoIl|SBZ.,]{3,}(?![A-Za-z])/g, (run) => {
    const digits = (run.match(/\d/g) || []).length;
    const letters = (run.match(/[OoIl|SBZ]/g) || []).length;
    if (digits < 2 || letters === 0) return run;
    return run.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
  });
  // "2 650" -> "2650" (space thousands separator)
  t = t.replace(/(?<![\d.,])(\d{1,3}) (\d{3})(?![\d])/g, '$1$2');
  // strip clock times like 12:30, 09:05:33, 9:41 PM
  t = t.replace(/(?<![A-Za-z0-9])\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:AM|PM|am|pm))?(?![0-9])/g, ' ');
  // list markers at line start: "1. ", "2) "
  t = t.replace(/(^|\n)\s*\d{1,2}\s*[.)\]]\s+/g, '$1 ');
  t = t.toUpperCase();
  return { text: t, emojiDir };
}

export function parseNumber(s, k) {
  if (s == null) return null;
  let str = String(s).trim();
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(str)) str = str.replace(/,/g, '');
  else if (/^\d+,\d+$/.test(str)) str = str.replace(',', '.');
  else str = str.replace(/,/g, '');
  let v = parseFloat(str);
  if (!Number.isFinite(v)) return null;
  if (k) v *= 1000;
  return v;
}

/**
 * Parse a signal. Returns structured fields plus flags describing what was inferred.
 */
export function parseSignal(raw, opts = {}) {
  const { text, emojiDir } = normalizeText(raw);
  const instrument = detectInstrument(text);
  let work = text;
  if (instrument && instrument.matched) {
    const re = new RegExp(escapeRe(instrument.matched.toUpperCase()), 'g');
    work = work.replace(re, ' ');
  }
  // remove hashtags / cashtags of other tickers to keep them out of the number stream
  work = work.replace(/[#$][A-Z][A-Z0-9]*/g, ' ');

  const out = {
    instrument,
    symbol: instrument ? instrument.symbol : null,
    kind: instrument ? instrument.kind : null,
    direction: null,
    directionSource: null,
    entry: null,
    entryRange: null,
    entryIsMarket: false,
    entrySource: null,
    sl: null,
    slPct: null,
    tps: [],
    tpPcts: [],
    leverage: null,
    riskPct: null,
    riskAmount: null,
    flags: [],
    text,
  };

  let ctx = 'none';
  let dirWord = null;
  let sawMarket = false;
  const entries = []; // numbers in entry context
  const tpsIdx = [];  // [{idx|null, value}]
  const orphans = []; // {value, pos}
  let lastEntryPos = -1;

  const pushEntry = (v) => { if (v != null) entries.push(v); };

  for (const m of work.matchAll(TOKEN_RE)) {
    const g = m.groups;
    if (g.dir) {
      if (!dirWord) {
        dirWord = /^(BUY|LONG)/.test(g.dir) ? 'long' : 'short';
        if (/\b(NOW|MARKET)\b/.test(g.dir)) sawMarket = true;
      }
      if (ctx !== 'entry' && ctx !== 'sl' && ctx !== 'tp') ctx = 'dir';
      continue;
    }
    if (g.reset) { ctx = 'none'; continue; }
    if (g.market) { sawMarket = true; if (ctx === 'dir') ctx = 'none'; continue; }
    if (g.entry) { ctx = 'entry'; continue; }
    if (g.wentry) { if (ctx === 'none' || ctx === 'dir') ctx = 'entry'; continue; }
    if (g.sl) { ctx = 'sl'; continue; }
    if (g.tp) {
      ctx = 'tp';
      const idx = g.tpidx || g.tpidx2;
      tpsIdx.push({ idx: idx ? parseInt(idx, 10) : null, value: null, pending: true });
      continue;
    }
    if (g.lev) {
      const n = parseInt(g.levn || g.levn2 || g.levn3, 10);
      if (n >= 1 && n <= 500 && out.leverage == null) out.leverage = n;
      continue;
    }
    if (g.risk) {
      const n = parseFloat(g.riskn);
      if (g.riskunit === '%' || (!g.riskunit && n <= 10)) out.riskPct = n;
      else out.riskAmount = n;
      continue;
    }
    if (g.pct) {
      const n = parseFloat(g.pctn);
      if (ctx === 'sl' && out.slPct == null) { out.slPct = n; ctx = 'none'; }
      else if (ctx === 'tp') out.tpPcts.push(n);
      continue;
    }
    if (g.noise) continue;

    let values = null;
    if (g.range) {
      const a = parseNumber(g.r1, g.rk); const b = parseNumber(g.r2, g.rk2);
      values = [a, b].filter((v) => v != null);
      // if the two sides are wildly different it is not a range (e.g. "12/5")
      if (values.length === 2 && Math.max(...values) / Math.min(...values) > 1.5) values = [values[0]];
    } else if (g.num) {
      const v = parseNumber(g.n, g.nk);
      values = v != null ? [v] : [];
    }
    if (!values || !values.length) continue;

    switch (ctx) {
      case 'entry':
        values.forEach(pushEntry);
        lastEntryPos = m.index + m[0].length;
        ctx = 'afterentry';
        break;
      case 'dir':
        values.forEach(pushEntry);
        lastEntryPos = m.index + m[0].length;
        out.entrySource = 'direction';
        ctx = 'afterentry';
        break;
      case 'sl':
        if (out.sl == null) out.sl = values[0];
        ctx = 'none';
        break;
      case 'tp': {
        for (const v of values) {
          const pending = tpsIdx.find((t) => t.pending);
          if (pending) { pending.value = v; pending.pending = false; }
          else tpsIdx.push({ idx: null, value: v, pending: false });
        }
        break;
      }
      case 'afterentry': {
        // "Entry 2650 2655" without a dash: adopt as range end if adjacent and close in value
        const gap = work.slice(lastEntryPos, m.index);
        if (entries.length && /^[\s,;&]*$/.test(gap) && values.length === 1 && Math.abs(values[0] - entries[0]) / entries[0] < 0.02) {
          entries.push(values[0]);
          lastEntryPos = m.index + m[0].length;
        } else {
          values.forEach((v) => orphans.push(v));
          ctx = 'none';
        }
        break;
      }
      default:
        values.forEach((v) => orphans.push(v));
    }
  }

  if (entries.length && out.entrySource !== 'direction') out.entrySource = 'keyword';

  // Take profits: honour explicit indices, then append the rest in order.
  const tpVals = [];
  const indexed = tpsIdx.filter((t) => t.value != null && t.idx != null).sort((a, b) => a.idx - b.idx);
  for (const t of indexed) tpVals[t.idx - 1] = t.value;
  for (const t of tpsIdx.filter((t) => t.value != null && t.idx == null)) {
    let i = 0; while (tpVals[i] != null) i++;
    tpVals[i] = t.value;
  }
  let tps = tpVals.filter((v) => v != null);

  // Entry
  let entry = null; let entryRange = null;
  if (entries.length >= 2) {
    const lo = Math.min(...entries); const hi = Math.max(...entries);
    entryRange = [lo, hi];
    entry = entries[0];
  } else if (entries.length === 1) {
    entry = entries[0];
  }

  // Plausibility filter: prices in one signal live within a factor of ~4 of each other.
  const ref = entry ?? out.sl ?? median(tps);
  if (ref) {
    const ok = (v) => v > ref / 4 && v < ref * 4;
    if (out.sl != null && !ok(out.sl)) { out.flags.push({ code: 'sl_implausible', msg: `Ignored stop loss ${out.sl} (too far from ${ref}).` }); out.sl = null; }
    const before = tps.length;
    tps = tps.filter(ok);
    if (tps.length !== before) out.flags.push({ code: 'tp_dropped', msg: 'Ignored a target that did not look like a price.' });
  }

  if (entry == null && !sawMarket && orphans.length) {
    const cand = orphans.find((v) => !ref || (v > ref / 4 && v < ref * 4));
    if (cand != null) { entry = cand; out.entrySource = 'guess'; out.flags.push({ code: 'entry_guess', msg: `Used ${cand} as entry (no "Entry" label found) — please check.` }); }
  }
  if (entry == null && sawMarket) out.entryIsMarket = true;
  if (entry == null && !sawMarket && (out.sl != null || tps.length)) out.entryIsMarket = true;

  // Direction
  if (dirWord) { out.direction = dirWord; out.directionSource = 'keyword'; }
  else if (emojiDir) { out.direction = emojiDir; out.directionSource = 'emoji'; }
  else if (/\bBULLISH\b/.test(text) && !/\bBEARISH\b/.test(text)) { out.direction = 'long'; out.directionSource = 'word'; }
  else if (/\bBEARISH\b/.test(text) && !/\bBULLISH\b/.test(text)) { out.direction = 'short'; out.directionSource = 'word'; }
  else if (entry != null && out.sl != null && out.sl !== entry) { out.direction = out.sl < entry ? 'long' : 'short'; out.directionSource = 'inferred'; }
  else if (entry != null && tps.length) { out.direction = tps[0] > entry ? 'long' : 'short'; out.directionSource = 'inferred'; }
  else if (out.sl != null && tps.length) { out.direction = tps[0] > out.sl ? 'long' : 'short'; out.directionSource = 'inferred'; }

  // Derive SL / TPs from percentages if given that way.
  if (out.sl == null && out.slPct != null && entry != null && out.direction) {
    out.sl = out.direction === 'long' ? entry * (1 - out.slPct / 100) : entry * (1 + out.slPct / 100);
    out.flags.push({ code: 'sl_from_pct', msg: `Stop loss set ${out.slPct}% from entry.` });
  }
  if (!tps.length && out.tpPcts.length && entry != null && out.direction) {
    tps = out.tpPcts.map((p) => (out.direction === 'long' ? entry * (1 + p / 100) : entry * (1 - p / 100)));
  }

  // Sort TPs in the profit direction, dedupe.
  tps = [...new Set(tps)];
  if (out.direction === 'long') tps.sort((a, b) => a - b);
  else if (out.direction === 'short') tps.sort((a, b) => b - a);

  // Consistency checks
  if (entry != null && out.sl != null && out.direction) {
    const wrongSide = out.direction === 'long' ? out.sl >= entry : out.sl <= entry;
    if (wrongSide) {
      const tpsOpposite = tps.length && (out.direction === 'long' ? tps[0] < entry : tps[0] > entry);
      if (out.directionSource === 'keyword' && tpsOpposite) {
        out.flags.push({ code: 'direction_conflict', msg: `Text says ${out.direction === 'long' ? 'BUY' : 'SELL'} but SL and TP are on the other side — check the direction.` });
      } else {
        out.flags.push({ code: 'sl_wrong_side', msg: `Stop loss must be ${out.direction === 'long' ? 'below' : 'above'} the entry for a ${out.direction === 'long' ? 'BUY' : 'SELL'}.` });
      }
    }
  }
  if (entry != null && out.direction && tps.length) {
    const bad = tps.filter((tp) => (out.direction === 'long' ? tp <= entry : tp >= entry));
    if (bad.length) out.flags.push({ code: 'tp_wrong_side', msg: `Target ${bad[0]} is on the wrong side of the entry.` });
  }
  if (!instrument) out.flags.push({ code: 'no_symbol', msg: 'Could not detect the instrument — pick Gold/FX or Crypto below.' });
  if (out.sl == null) out.flags.push({ code: 'no_sl', msg: 'No stop loss found — enter one to size the trade.' });
  if (entry == null) out.flags.push({ code: 'no_entry', msg: out.entryIsMarket ? 'Market entry — type the price you got filled at.' : 'No entry price found.' });

  out.entry = entry;
  out.entryRange = entryRange;
  out.tps = tps;
  return out;
}

/** Merge two parses: values from `primary` win, `secondary` fills the gaps. */
export function mergeParsed(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const out = { ...primary };
  for (const k of ['instrument', 'symbol', 'kind', 'direction', 'entry', 'entryRange', 'sl', 'leverage', 'riskPct', 'riskAmount']) {
    if (out[k] == null && secondary[k] != null) out[k] = secondary[k];
  }
  if (!out.tps.length && secondary.tps.length) out.tps = secondary.tps;
  if (out.entry != null) out.entryIsMarket = false;
  const codes = new Set(['no_symbol', 'no_sl', 'no_entry']);
  out.flags = out.flags.filter((f) => !codes.has(f.code) || (f.code === 'no_symbol' && !out.instrument) || (f.code === 'no_sl' && out.sl == null) || (f.code === 'no_entry' && out.entry == null));
  return out;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const LEVEL_KW = /(?<![A-Z])(?:SL|S\.L|STOP|TP\d?|TAKE[\s-]*PROFIT|TARGETS?|ENTRY|ENTRIES|ENTER)(?![A-Z])/i;
const DIR_KW = /(?<![A-Z])(?:BUY|SELL|LONG|SHORT)(?![A-Z])(?!\s*TERM)/i;

/**
 * Split text that may contain several signals (e.g. a chat screenshot) into one chunk per signal.
 */
export function splitSignals(rawText) {
  const lines = String(rawText || '').split('\n');
  const segments = [];
  let cur = [];
  let hasLevel = false;
  const isHeader = (line) => {
    const head = line.slice(0, 40);
    const dirIdx = head.search(DIR_KW);
    const inst = detectInstrument(head);
    const instIdx = inst ? head.toUpperCase().indexOf(inst.matched.toUpperCase()) : -1;
    const idx = [dirIdx, instIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (idx == null || idx > 25) return false;
    if (!LEVEL_KW.test(line)) return true;
    // single-line signal: direction + a level keyword on the same line
    return dirIdx >= 0 && dirIdx <= 25;
  };
  for (const line of lines) {
    if (cur.length && hasLevel && isHeader(line)) {
      segments.push(cur.join('\n'));
      cur = [];
      hasLevel = false;
    }
    cur.push(line);
    if (LEVEL_KW.test(line)) hasLevel = true;
  }
  if (cur.length) segments.push(cur.join('\n'));
  return segments.filter((s) => s.trim().length);
}

/** Parse every signal in the text. Returns an array ordered by appearance (at least one item). */
export function parseSignals(rawText) {
  const segs = splitSignals(rawText);
  const parsed = segs.map((s) => parseSignal(s)).filter((p) => p.sl != null || p.tps.length || p.entry != null);
  if (!parsed.length) return [parseSignal(rawText)];
  return parsed;
}

/** Completeness score used to pick a default among several parsed signals. */
export function signalScore(p) {
  if (!p) return -1;
  return (p.symbol ? 2 : 0) + (p.direction ? 1 : 0) + (p.entry != null ? 2 : 0) + (p.sl != null ? 3 : 0) + Math.min(3, p.tps.length);
}
