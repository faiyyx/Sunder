// Persistence (localStorage) for settings and trades.
import { DEFAULT_PLAN } from './manage.js';

const K_SETTINGS = 'signalsize.settings.v1';
const K_TRADES = 'signalsize.trades.v1';

export const DEFAULT_SETTINGS = {
  currency: '$',
  balance: 0,
  riskPct: 1,
  riskPresets: [10, 25, 50, 100],
  lastRisk: 0,
  lots: { contractSize: 100, lotStep: 0.01, minLot: 0.01, maxLot: 0, commissionPerLot: 0 },
  crypto: { leverage: 1, feePct: 0.05, includeFees: false },
  plan: { ...DEFAULT_PLAN },
  contractOverrides: {}, // symbol -> contract size
  ocrAuto: true,
  live: { enabled: true, finnhubKey: '', allowApprox: true },
};

function safeParse(s, fallback) {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}

export function loadSettings() {
  let raw = null;
  try { raw = localStorage.getItem(K_SETTINGS); } catch { /* private mode */ }
  return deepMerge(structuredClone(DEFAULT_SETTINGS), safeParse(raw, {}));
}

export function saveSettings(s) {
  try { localStorage.setItem(K_SETTINGS, JSON.stringify(s)); } catch { /* ignore */ }
}

export function loadTrades() {
  let raw = null;
  try { raw = localStorage.getItem(K_TRADES); } catch { /* ignore */ }
  const arr = safeParse(raw, []);
  return Array.isArray(arr) ? arr : [];
}

export function saveTrades(trades) {
  try { localStorage.setItem(K_TRADES, JSON.stringify(trades)); } catch { /* ignore */ }
}

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function exportAll() {
  return JSON.stringify({ app: 'signalsize', version: 1, exportedAt: new Date().toISOString(), settings: loadSettings(), trades: loadTrades() }, null, 2);
}

export function importAll(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || (data.app !== 'signalsize' && data.app !== 'sunder')) throw new Error('Not a SignalSize backup file');
  if (data.settings) saveSettings(deepMerge(structuredClone(DEFAULT_SETTINGS), data.settings));
  if (Array.isArray(data.trades)) saveTrades(data.trades);
  return { trades: (data.trades || []).length };
}

export function clearAll() {
  try { localStorage.removeItem(K_SETTINGS); localStorage.removeItem(K_TRADES); } catch { /* ignore */ }
}
