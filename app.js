// SignalSize — signal → position size → trade management. No framework, no network needed.
import { parseSignals, mergeParsed, signalScore, parseNumber } from './src/parser.js';
import { instrumentForSymbol } from './src/instruments.js';
import { sizeTrade } from './src/calc.js';
import { assess, buildPlan, remainingSize, realizedPnl } from './src/manage.js';
import { fmtPrice, fmtMoney, fmtSigned, fmtLots, fmtQty, fmtPct, fmtR } from './src/format.js';
import { loadSettings, saveSettings, loadTrades, saveTrades, newId, exportAll, importAll, clearAll } from './src/store.js';
import { recognizeImage, ocrPackCached, downloadOcrPack, warmOcr } from './src/ocr.js';
import { watchPrice, stopAllPrices, liveSourceLabels } from './src/prices.js';
import { priceDecimals } from './src/format.js';

const APP_VERSION = '1.0.0 (__BUILD__)';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { if (v == null || v === '') return null; if (typeof v === 'number') return Number.isFinite(v) ? v : null; const n = parseNumber(String(v).trim()); return n != null && Number.isFinite(n) ? n : null; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const state = {
  settings: loadSettings(),
  trades: loadTrades(),
  tab: 'size',
  text: '',
  ocrText: '',
  imageBlob: null,
  candidates: [],
  chosen: -1,
  filledSig: '',
  parsed: null,
  form: { symbol: '', instrument: null, kind: 'lots', direction: 'long', entry: '', entryRange: null, sl: '', tps: [], contractSize: '', quoteRate: '', leverage: '', feePct: '', risk: '' },
  result: null,
  manageId: null,
  managePrice: '',
  deferredInstall: null,
  swReg: null,
  live: { sub: null, symbol: null, price: null, status: 'idle', source: null, approx: false, autoFilled: null },
  mLive: { sub: null, tradeId: null, price: null, status: 'idle', source: null, approx: false, paused: false, reason: '' },
  listSubs: [],
};

const cur = () => state.settings.currency || '$';

/* ---------------------------------------------------------------- boot */
function init() {
  bindTabs();
  bindSizeTab();
  bindSettingsTab();
  renderSettingsForm();
  renderRiskChips();
  const s = state.settings;
  const initialRisk = s.lastRisk || (s.balance && s.riskPct ? round2(s.balance * s.riskPct / 100) : (s.riskPresets[0] || ''));
  state.form.risk = initialRisk ? String(initialRisk) : '';
  $('fRisk').value = state.form.risk;
  $('curSym').textContent = cur();
  syncRiskPct();
  state.form.contractSize = String(s.lots.contractSize);
  state.form.leverage = String(s.crypto.leverage || 1);
  state.form.feePct = String(s.crypto.feePct ?? '');
  writeForm();
  compute();
  updateOpenCount();
  $('appVersion').textContent = APP_VERSION;
  document.addEventListener('paste', onDocumentPaste);
  window.addEventListener('online', updateNetPill);
  window.addEventListener('offline', updateNetPill);
  updateNetPill();
  setupInstall();
  registerSW();
  handleUrlParams();
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAllLive(); else resumeLiveForView(); });
}

function updateNetPill() {
  const p = $('netPill');
  if (navigator.onLine) { p.textContent = 'online'; p.className = 'pill ok'; } else { p.textContent = 'offline'; p.className = 'pill off'; }
}

function toast(msg, opts = {}) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (opts.action ? ' action' : '');
  t.onclick = opts.action || null;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast hidden'; }, opts.ms || 2600);
}

function round2(x) { return Math.round(x * 100) / 100; }

/* ---------------------------------------------------------------- tabs */
function bindTabs() {
  document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
}
function showTab(name) {
  state.tab = name;
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name !== 'size') stopFormLive(); else syncFormLive();
  if (name !== 'manage') { stopManageLive(); stopListLive(); }
  if (name === 'manage') renderManage();
  if (name === 'settings') refreshOcrPackStatus();
  window.scrollTo({ top: 0 });
}

/* ---------------------------------------------------------------- size tab */
function bindSizeTab() {
  const ta = $('sigText');
  ta.addEventListener('input', debounce(() => { state.text = ta.value; reparse(); }, 120));
  $('btnImage').addEventListener('click', () => { warmOcr(); $('fileInput').click(); });
  $('fileInput').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) handleImage(f); e.target.value = ''; });
  $('btnPaste').addEventListener('click', pasteFromClipboard);
  $('btnClear').addEventListener('click', clearSignal);
  $('btnRemoveImg').addEventListener('click', removeImage);

  $('fSymbol').addEventListener('change', onSymbolTyped);
  $('fSymbol').addEventListener('blur', onSymbolTyped);
  $('fKind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; setKind(b.dataset.v); });
  $('fDir').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.form.direction = b.dataset.v; writeSeg(); compute(); });
  $('fEntry').addEventListener('input', () => { state.form.entry = $('fEntry').value; compute(); });
  $('fSl').addEventListener('input', () => { state.form.sl = $('fSl').value; compute(); });
  $('btnAddTp').addEventListener('click', () => { state.form.tps.push(''); renderTpRows(); const inputs = $('tpList').querySelectorAll('input'); inputs[inputs.length - 1].focus(); });
  $('tpList').addEventListener('input', (e) => { const i = Number(e.target.dataset.i); if (Number.isFinite(i)) { state.form.tps[i] = e.target.value; compute(); } });
  $('tpList').addEventListener('click', (e) => { const x = e.target.closest('.x'); if (!x) return; state.form.tps.splice(Number(x.dataset.i), 1); renderTpRows(); compute(); });
  $('fContract').addEventListener('input', () => { state.form.contractSize = $('fContract').value; rememberContract(); compute(); });
  $('fQuoteRate').addEventListener('input', () => { state.form.quoteRate = $('fQuoteRate').value; compute(); });
  $('fLev').addEventListener('input', () => { state.form.leverage = $('fLev').value; compute(); });
  $('fFee').addEventListener('input', () => { state.form.feePct = $('fFee').value; compute(); });
  $('fRisk').addEventListener('input', () => { state.form.risk = $('fRisk').value; syncRiskPct(); compute(); persistRisk(); });
  $('fRiskPct').addEventListener('input', () => {
    const pct = num($('fRiskPct').value); const bal = state.settings.balance;
    if (pct != null && bal > 0) { state.form.risk = String(round2(bal * pct / 100)); $('fRisk').value = state.form.risk; compute(); persistRisk(); }
  });
  $('riskChips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c || c.dataset.v == null) return; state.form.risk = c.dataset.v; $('fRisk').value = c.dataset.v; syncRiskPct(); compute(); persistRisk(); });
  $('entryChips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c || c.dataset.v == null) return; state.form.entry = c.dataset.v; $('fEntry').value = c.dataset.v; renderEntryChips(); compute(); });
  $('signalPicker').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; applyCandidate(Number(c.dataset.i), true); });
  $('btnSave').addEventListener('click', saveTrade);
  $('btnCopy').addEventListener('click', copySummary);
  $('liveBadge').addEventListener('click', (e) => { const c = e.target.closest('[data-use]'); if (!c || state.live.price == null) return; const v = liveValueString(state.live.price, [num(state.form.entry), num(state.form.sl)]); state.form.entry = v; $('fEntry').value = v; renderEntryChips(); compute(); });
}

const persistRisk = debounce(() => { const r = num(state.form.risk); if (r) { state.settings.lastRisk = r; saveSettings(state.settings); } }, 400);

function rememberContract() {
  const f = state.form; const v = num(f.contractSize);
  if (!f.symbol || !v) return;
  if (f.symbol === 'XAUUSD') state.settings.lots.contractSize = v;
  else state.settings.contractOverrides[f.symbol] = v;
  saveSettings(state.settings);
}

function contractFor(inst) {
  const s = state.settings;
  if (!inst) return s.lots.contractSize;
  if (inst.symbol === 'XAUUSD') return s.lots.contractSize;
  if (s.contractOverrides[inst.symbol]) return s.contractOverrides[inst.symbol];
  return inst.contractSize || 1;
}

function setText(t) { $('sigText').value = t; state.text = t; reparse(); }

function clearSignal() {
  $('sigText').value = ''; state.text = '';
  removeImage(false);
  state.candidates = []; state.chosen = -1; state.filledSig = ''; state.parsed = null;
  const f = state.form;
  Object.assign(f, { symbol: '', instrument: null, entry: '', entryRange: null, sl: '', tps: [] });
  writeForm(); renderPicker(); showFlags([]); compute(); syncFormLive();
  $('sigText').focus();
}

function removeImage(reparseAfter = true) {
  state.imageBlob = null; state.ocrText = '';
  $('imgBox').classList.add('hidden'); $('ocrDetails').classList.add('hidden'); $('ocrText').textContent = '';
  if ($('imgPreview').src) { URL.revokeObjectURL($('imgPreview').src); $('imgPreview').removeAttribute('src'); }
  if (reparseAfter) reparse();
}

async function pasteFromClipboard() {
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const imgType = it.types.find((t) => t.startsWith('image/'));
        if (imgType) { handleImage(await it.getType(imgType)); return; }
      }
      for (const it of items) {
        if (it.types.includes('text/plain')) { const t = await (await it.getType('text/plain')).text(); if (t.trim()) { setText(t); return; } }
      }
    }
    if (navigator.clipboard && navigator.clipboard.readText) {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) { setText(t); return; }
    }
    throw new Error('empty');
  } catch (e) {
    $('sigText').focus();
    toast('Clipboard blocked — long-press the box and tap Paste');
  }
}

function onDocumentPaste(e) {
  const cd = e.clipboardData; if (!cd) return;
  for (const item of cd.items || []) {
    if (item.type && item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) { e.preventDefault(); handleImage(f); return; } }
  }
  if (e.target !== $('sigText') && state.tab === 'size') {
    const t = cd.getData('text/plain'); if (t && t.trim()) { e.preventDefault(); setText(t); }
  }
}

async function handleImage(blob) {
  state.imageBlob = blob;
  const box = $('imgBox'); box.classList.remove('hidden');
  const img = $('imgPreview'); if (img.src) URL.revokeObjectURL(img.src); img.src = URL.createObjectURL(blob);
  const st = $('ocrStatus'); const pr = $('ocrProgress');
  st.textContent = 'Loading reader…'; pr.value = 0; pr.classList.remove('hidden');
  if (state.tab !== 'size') showTab('size');
  try {
    const res = await recognizeImage(blob, (m) => {
      if (!m) return;
      const label = { 'preparing image': 'Preparing image…', 'loading tesseract core': 'Loading OCR engine…', 'initializing tesseract': 'Starting engine…', 'loading language traineddata': 'Loading language…', 'initializing api': 'Almost ready…', 'recognizing text': 'Reading text…' }[m.status] || m.status;
      st.textContent = label; if (typeof m.progress === 'number') pr.value = m.progress;
    });
    state.ocrText = res.text || '';
    pr.value = 1; pr.classList.add('hidden');
    st.textContent = res.text.trim() ? `Read in ${(res.ms / 1000).toFixed(1)}s · confidence ${Math.round(res.confidence)}%` : 'No text found in the image';
    $('ocrText').textContent = res.text; $('ocrDetails').classList.toggle('hidden', !res.text.trim());
    reparse();
  } catch (err) {
    pr.classList.add('hidden');
    st.textContent = `Could not read the image (${err && err.message ? err.message : err}). Type the levels below.`;
    console.error(err);
  }
}

/* ---------------------------------------------------------------- parsing → form */
function bestOf(list) { let b = -1; list.forEach((c, i) => { if (b < 0 || signalScore(c) >= signalScore(list[b])) b = i; }); return b; }

function reparse() {
  const textCands = state.text.trim() ? parseSignals(state.text) : [];
  const ocrCands = state.ocrText.trim() ? parseSignals(state.ocrText) : [];
  let cands;
  if (textCands.length && ocrCands.length) {
    const bt = bestOf(textCands); const bo = bestOf(ocrCands);
    cands = [mergeParsed(textCands[bt], ocrCands[bo]), ...textCands.filter((_, i) => i !== bt), ...ocrCands.filter((_, i) => i !== bo)];
  } else cands = textCands.length ? textCands : ocrCands;
  cands = cands.filter((c) => signalScore(c) > 0);
  state.candidates = cands;
  if (!cands.length) { state.chosen = -1; renderPicker(); showFlags([]); return; }
  applyCandidate(bestOf(cands), false);
}

function candidateLabel(p) {
  const parts = [p.symbol || '?', p.direction ? (p.direction === 'long' ? 'BUY' : 'SELL') : '', p.entry != null ? `@ ${fmtPrice(p.entry, [p.entry])}` : (p.entryIsMarket ? '@ market' : ''), p.sl != null ? `SL ${fmtPrice(p.sl, [p.sl])}` : ''];
  return parts.filter(Boolean).join(' ');
}

function renderPicker() {
  const el = $('signalPicker');
  if (state.candidates.length < 2) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = `<div class="ptitle">${state.candidates.length} signals found — pick one</div><div class="chips">${state.candidates.map((c, i) => `<button type="button" class="chip ${i === state.chosen ? 'on' : ''}" data-i="${i}">${esc(candidateLabel(c))}</button>`).join('')}</div>`;
}

function applyCandidate(i, force) {
  const p = state.candidates[i]; if (!p) return;
  state.chosen = i; state.parsed = p;
  renderPicker();
  const sig = JSON.stringify([p.symbol, p.direction, p.entry, p.entryRange, p.sl, p.tps, p.leverage, i]);
  if (!force && sig === state.filledSig) { showFlags(p.flags); return; }
  state.filledSig = sig;
  fillForm(p);
}

function fillForm(p) {
  const f = state.form; const s = state.settings;
  if (p.instrument) { f.instrument = p.instrument; f.symbol = p.instrument.symbol; f.kind = p.kind; f.contractSize = String(contractFor(p.instrument)); }
  if (p.direction) f.direction = p.direction;
  f.entry = p.entry != null ? String(p.entry) : '';
  f.entryRange = p.entryRange;
  f.sl = p.sl != null ? String(p.sl) : '';
  f.tps = p.tps.map(String);
  if (f.kind === 'usdt') f.leverage = String(p.leverage || s.crypto.leverage || 1);
  writeForm();
  showFlags(p.flags, p);
  compute();
  syncFormLive();
}

function onSymbolTyped() {
  const v = $('fSymbol').value.trim().toUpperCase();
  const f = state.form;
  if (v === f.symbol) return;
  f.symbol = v;
  const inst = instrumentForSymbol(v);
  f.instrument = inst;
  if (inst) { f.kind = inst.kind; f.contractSize = String(contractFor(inst)); if (inst.kind === 'usdt' && !num(f.leverage)) f.leverage = String(state.settings.crypto.leverage || 1); }
  writeForm(); compute(); syncFormLive();
}

function setKind(k) {
  const f = state.form;
  if (f.kind === k) return;
  f.kind = k;
  if (k === 'lots' && !num(f.contractSize)) f.contractSize = String(f.instrument && f.instrument.kind === 'lots' ? contractFor(f.instrument) : (f.symbol.startsWith('XAU') ? state.settings.lots.contractSize : 1));
  if (k === 'usdt' && !num(f.leverage)) f.leverage = String(state.settings.crypto.leverage || 1);
  writeForm(); compute();
}

function writeSeg() {
  const f = state.form;
  $('fKind').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.kind));
  $('fDir').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === f.direction));
  $('lotsFields').classList.toggle('hidden', f.kind !== 'lots');
  $('usdtFields').classList.toggle('hidden', f.kind !== 'usdt');
}

function writeForm() {
  const f = state.form;
  $('fSymbol').value = f.symbol;
  $('fEntry').value = f.entry;
  $('fSl').value = f.sl;
  $('fContract').value = f.contractSize;
  $('fQuoteRate').value = f.quoteRate;
  $('fLev').value = f.leverage;
  $('fFee').value = f.feePct;
  writeSeg();
  renderTpRows();
  renderEntryChips();
  renderSymbolHint();
}

function renderSymbolHint() {
  const f = state.form; const el = $('symbolHint');
  if (!f.symbol) { el.textContent = ''; return; }
  if (f.instrument) el.textContent = f.instrument.name + (f.instrument.kind === 'lots' && f.instrument.note ? ` · ${f.instrument.note}` : '');
  else el.textContent = 'Unknown symbol — check "Sized in" and contract size.';
}

function renderEntryChips() {
  const el = $('entryChips'); const r = state.form.entryRange;
  if (!r || r[0] === r[1]) { el.innerHTML = ''; return; }
  const mid = (r[0] + r[1]) / 2; const refs = [r[0], r[1]];
  const chips = [[r[0], 'low'], [mid, 'mid'], [r[1], 'high']];
  const curV = num(state.form.entry);
  el.innerHTML = `<span class="chip muted" style="cursor:default">zone</span>` + chips.map(([v, l]) => `<button type="button" class="chip ${curV === v ? 'on' : ''}" data-v="${v}">${fmtPrice(v, refs)} <span class="muted">${l}</span></button>`).join('');
}

function renderTpRows() {
  const f = state.form; const list = $('tpList');
  if (!f.tps.length) f.tps.push('');
  list.innerHTML = f.tps.map((v, i) => `<div class="tprow"><span class="tplabel">TP${i + 1}</span><input type="text" inputmode="decimal" data-i="${i}" value="${esc(v)}" placeholder="target price" autocomplete="off"><span class="tpr" data-r="${i}"></span>${f.tps.length > 1 ? `<button type="button" class="x" data-i="${i}" aria-label="remove">×</button>` : ''}</div>`).join('');
}

function showFlags(flags, p) {
  const el = $('parseFlags');
  const items = [];
  for (const fl of flags || []) {
    const level = ['direction_conflict', 'sl_wrong_side'].includes(fl.code) ? 'err' : ['sl_from_pct', 'entry_guess'].includes(fl.code) ? 'info' : '';
    items.push(`<div class="flag ${level}">${esc(fl.msg)}</div>`);
  }
  if (p && p.riskPct && state.settings.balance > 0) {
    const amt = round2(state.settings.balance * p.riskPct / 100);
    items.push(`<div class="flag info">Signal suggests risking ${p.riskPct}% → <b>${fmtMoney(amt, cur())}</b> of your balance.</div>`);
  }
  el.innerHTML = items.join('');
}

/* ---------------------------------------------------------------- risk */
function syncRiskPct() {
  const bal = state.settings.balance; const r = num(state.form.risk);
  const show = bal > 0;
  $('fRiskPct').classList.toggle('hidden', !show); $('riskEq').classList.toggle('hidden', !show); $('riskPctLabel').classList.toggle('hidden', !show);
  if (show && document.activeElement !== $('fRiskPct')) $('fRiskPct').value = r ? String(Math.round((r / bal) * 10000) / 100) : '';
}

function renderRiskChips() {
  const s = state.settings; const el = $('riskChips');
  const chips = (s.riskPresets || []).filter((v) => v > 0).map((v) => `<button type="button" class="chip" data-v="${v}">${fmtMoney(v, cur(), 0)}</button>`);
  if (s.balance > 0) for (const p of [0.5, 1, 2]) chips.push(`<button type="button" class="chip" data-v="${round2(s.balance * p / 100)}">${p}% <span class="muted">${fmtMoney(round2(s.balance * p / 100), cur(), 0)}</span></button>`);
  el.innerHTML = chips.join('');
}

/* ---------------------------------------------------------------- compute + result */
function quoteRateInfo() {
  const f = state.form; const inst = f.instrument;
  if (f.kind !== 'lots') return { rate: 1, auto: true, show: false };
  if (!inst || inst.quote === 'USD' || !inst.quote) return { rate: 1, auto: true, show: false };
  const entry = num(f.entry);
  if (inst.base === 'USD' && entry) return { rate: 1 / entry, auto: true, show: true, label: `1 ${inst.quote} = ${(1 / entry).toFixed(6)} USD (from entry price)` };
  const r = num(f.quoteRate);
  return { rate: r || 1, auto: false, show: true, label: r ? `1 ${inst.quote} = ${r} USD` : `Enter the USD value of 1 ${inst.quote} (e.g. USD${inst.quote} = 150 → 0.00667)`, missing: !r };
}

function compute() {
  const f = state.form; const s = state.settings;
  const entry = num(f.entry); const sl = num(f.sl); const risk = num(f.risk);
  const tps = f.tps.map(num).filter((v) => v != null && v > 0);
  const q = quoteRateInfo();
  $('quoteField').classList.toggle('hidden', !q.show);
  $('quoteHint').textContent = q.label || '';
  $('quoteHint').className = 'hint' + (q.missing ? ' warn' : '');
  $('fQuoteRate').readOnly = q.auto; if (q.auto && q.show) $('fQuoteRate').value = (1 / entry).toFixed(6);
  $('contractHint').textContent = f.kind === 'lots' && f.instrument && f.instrument.note ? f.instrument.note : (f.kind === 'lots' ? 'Units per 1.00 lot. Gold is 100 on almost every broker.' : '');
  $('feeHint').textContent = s.crypto.includeFees ? 'Round-trip fees are included in the risk.' : 'Fees not included (enable in Settings).';
  $('fEntry').classList.toggle('invalid', f.entry !== '' && entry == null);
  $('fSl').classList.toggle('invalid', f.sl !== '' && sl == null);

  let slHint = '';
  if (entry && sl) {
    const d = Math.abs(entry - sl); const pct = d / entry;
    slHint = `${fmtPrice(d, [entry, sl])} away (${fmtPct(pct)})`;
    if (f.kind === 'lots' && f.instrument && ['XAUUSD', 'XAGUSD'].includes(f.instrument.symbol)) slHint += ` · ${Math.round(d * 100)} points`;
    if (f.kind === 'lots' && f.instrument && f.instrument.contractSize === 100000) slHint += ` · ${(d / (f.instrument.quote === 'JPY' ? 0.01 : 0.0001)).toFixed(1)} pips`;
  }
  $('slHint').textContent = slHint;

  const input = {
    kind: f.kind, direction: f.direction, entry, sl, tps, risk,
    contractSize: num(f.contractSize) || 1, quoteToUsd: q.rate, lotStep: s.lots.lotStep || 0.01, minLot: s.lots.minLot || 0.01, maxLot: s.lots.maxLot || 0, commissionPerLot: s.lots.commissionPerLot || 0,
    leverage: num(f.leverage) || 1, feePct: s.crypto.includeFees ? (num(f.feePct) ?? s.crypto.feePct ?? 0) : 0,
  };
  state.result = entry && sl && risk ? sizeTrade(input) : null;
  state.lastInput = input;
  renderResult();
  updateTpR();
}

function updateTpR() {
  const r = state.result;
  $('tpList').querySelectorAll('.tpr').forEach((el) => {
    const i = Number(el.dataset.r); const tp = num(state.form.tps[i]);
    if (!r || r.error || tp == null || !r.risk1R) { el.textContent = ''; return; }
    const dir = state.form.direction === 'short' ? -1 : 1; const rr = ((tp - r.entry) * dir) / r.risk1R;
    el.textContent = rr > 0 ? `${rr.toFixed(1)}R` : 'wrong side'; el.className = 'tpr' + (rr > 0 ? '' : ' neg');
  });
}

function renderResult() {
  const el = $('resultCard'); const r = state.result; const f = state.form; const c = cur();
  const entry = num(f.entry); const sl = num(f.sl); const risk = num(f.risk);
  $('btnSave').disabled = !(r && !r.error && r.size > 0);
  if (!r) {
    const missing = [!entry && 'entry price', !sl && 'stop loss', !risk && 'risk amount'].filter(Boolean);
    el.innerHTML = `<div class="empty">Enter the ${missing.join(', ')} to get your size.</div>`;
    return;
  }
  if (r.error) { el.innerHTML = `<div class="alert err">${esc(r.error)}.</div>`; return; }
  const refs = [entry, sl, ...f.tps.map(num)];
  const dirWord = f.direction === 'long' ? 'BUY' : 'SELL';
  const sym = f.symbol || (f.kind === 'lots' ? 'CFD' : 'crypto');
  let html = '';
  if (r.kind === 'lots') {
    const lotsTxt = fmtLots(r.lots, state.settings.lots.lotStep);
    html += `<div class="headline"><span class="big">${r.belowMin ? '0.00' : lotsTxt}</span><span class="unit">lots</span><span class="sub">${dirWord} ${esc(sym)} @ ${fmtPrice(entry, refs)}</span></div>`;
    if (r.belowMin) html += `<div class="alert warn">Your stop is too wide for this risk: even the minimum <b>${fmtLots(r.minLot, state.settings.lots.lotStep)} lot</b> would risk <b>${fmtMoney(r.minLotRisk, c)}</b>. Tighten the stop or accept the higher risk.</div>`;
    else if (r.aboveMax) html += `<div class="alert warn">Capped at your maximum of ${fmtLots(r.lots)} lots.</div>`;
    html += `<div class="kv">
      <span class="k">Risk at stop</span><span class="v"><b>${fmtMoney(r.riskActual, c)}</b>${Math.abs(r.riskActual - risk) > 0.005 ? ` <span class="muted">(rounded from ${fmtMoney(risk, c)})</span>` : ''}</span>
      <span class="k">Per lot at stop</span><span class="v">${fmtMoney(r.riskPerLot, c)}</span>
      <span class="k">Stop distance</span><span class="v">${fmtPrice(r.dist, refs)}</span>
      <span class="k">Value of 1.00 move</span><span class="v">${fmtMoney(r.valuePerUnit * (r.lots || 0), c)} <span class="muted">(${fmtMoney(r.valuePerUnit, c)}/lot)</span></span>
    </div>`;
  } else {
    const lev = r.leverage;
    html += `<div class="headline"><span class="big">${fmtMoney(r.notional, '', r.notional >= 100 ? 0 : 2)}</span><span class="unit">USDT</span><span class="sub">${dirWord} ${esc(sym)} @ ${fmtPrice(entry, refs)}</span></div>`;
    html += `<div class="sub">= <b>${fmtQty(r.qty)} ${esc(f.instrument && f.instrument.base ? f.instrument.base : 'coins')}</b> at ${fmtPrice(entry, refs)}${lev > 1 ? ` · with ${lev}x you post <b>${fmtMoney(r.margin, '', 2)} USDT</b> margin` : ''}</div>`;
    if (r.liqWarning) html += `<div class="alert err">At ${lev}x, liquidation (~${fmtPct(r.liqDist, 1)} away) comes before or near your stop (${fmtPct(r.distPct)}). Lower the leverage or tighten the stop.</div>`;
    html += `<div class="kv">
      <span class="k">Risk at stop</span><span class="v"><b>${fmtMoney(r.riskActual, c)}</b>${r.feeCost ? ` <span class="muted">incl. ${fmtMoney(r.feeCost, c)} fees</span>` : ''}</span>
      <span class="k">Stop distance</span><span class="v">${fmtPct(r.distPct)} <span class="muted">(${fmtPrice(r.dist, refs)})</span></span>
      <span class="k">Value of 1% move</span><span class="v">${fmtMoney(r.notional * 0.01, c)}</span>
      ${lev > 1 ? `<span class="k">Effective position</span><span class="v">${fmtMoney(r.notional, '', 0)} USDT</span>` : ''}
    </div>`;
  }
  const valid = r.targets.filter((t) => t.valid);
  if (r.targets.length) {
    html += `<table class="tbl"><tr><th>Target</th><th class="r">Price</th><th class="r">R</th><th class="r">Profit</th>${state.settings.balance > 0 ? '<th class="r">Acct</th>' : ''}</tr>`;
    for (const t of r.targets) {
      html += `<tr><td>${t.label}</td><td class="r">${fmtPrice(t.price, refs)}</td><td class="r">${t.valid ? fmtR(t.r) : '<span class="neg">wrong side</span>'}</td><td class="r ${t.valid ? 'pos' : 'neg'}">${t.valid ? fmtSigned(t.profit, c) : '—'}</td>${state.settings.balance > 0 ? `<td class="r muted">${t.valid ? fmtPct(t.profit / state.settings.balance, 1) : ''}</td>` : ''}</tr>`;
    }
    html += '</table>';
    if (valid.length) {
      const plan = buildPlan(previewTrade(r), state.settings.plan);
      const blended = plan.reduce((s, st) => s + (st.pct / 100) * (r.perUnit * r.size) * Math.abs(st.price - entry), 0);
      html += `<div class="hint">Plan: ${plan.map((st) => `${st.pct}% at ${st.label}`).join(', ')} → about <b class="pos">${fmtSigned(blended, c)}</b> if all targets hit (${(blended / Math.max(r.riskActual, 1e-9)).toFixed(1)}R blended).</div>`;
    }
  } else {
    html += `<div class="hint">No targets — the plan will use 1R / 2R / 3R (${[1, 2, 3].map((k) => fmtPrice(entry + (f.direction === 'short' ? -1 : 1) * k * r.risk1R, refs)).join(' / ')}).</div>`;
  }
  el.innerHTML = html;
}

function previewTrade(r) {
  const f = state.form;
  return { kind: f.kind, direction: f.direction, entry: r.entry, sl: r.sl, tps: f.tps.map(num).filter((v) => v != null), size: r.size, perUnit: r.perUnit, lotStep: state.settings.lots.lotStep, qtyStep: 0 };
}

/* ---------------------------------------------------------------- save / copy */
function summaryText() {
  const r = state.result; const f = state.form; const c = cur();
  if (!r || r.error) return '';
  const refs = [r.entry, r.sl, ...f.tps.map(num)];
  const tps = r.targets.map((t) => fmtPrice(t.price, refs)).join(' / ');
  const lines = [`${f.symbol || ''} ${f.direction === 'long' ? 'BUY' : 'SELL'} @ ${fmtPrice(r.entry, refs)} | SL ${fmtPrice(r.sl, refs)}${tps ? ` | TP ${tps}` : ''}`];
  if (r.kind === 'lots') lines.push(`Risk ${fmtMoney(r.riskActual, c)} → ${fmtLots(r.lots, state.settings.lots.lotStep)} lots (${fmtMoney(r.riskPerLot, c)} per lot at SL)`);
  else lines.push(`Risk ${fmtMoney(r.riskActual, c)} → buy for ${fmtMoney(r.notional, '', 2)} USDT = ${fmtQty(r.qty)} ${f.instrument && f.instrument.base ? f.instrument.base : ''}${r.leverage > 1 ? ` (${r.leverage}x, margin ${fmtMoney(r.margin, '', 2)} USDT)` : ''}`);
  if (r.targets.length) lines.push(r.targets.filter((t) => t.valid).map((t) => `${t.label} ${fmtSigned(t.profit, c)} (${fmtR(t.r)})`).join(' · '));
  return lines.join('\n');
}

async function copySummary() {
  const t = summaryText(); if (!t) { toast('Nothing to copy yet'); return; }
  try { await navigator.clipboard.writeText(t); toast('Copied'); } catch {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch { toast('Copy failed'); }
    ta.remove();
  }
}

function saveTrade() {
  const r = state.result; const f = state.form;
  if (!r || r.error || !(r.size > 0)) return;
  const trade = {
    id: newId(), createdAt: Date.now(), status: 'open',
    symbol: f.symbol || (f.kind === 'lots' ? 'CFD' : 'CRYPTO'), kind: f.kind, direction: f.direction,
    entry: r.entry, sl: r.sl, currentSl: r.sl, tps: f.tps.map(num).filter((v) => v != null && v > 0),
    size: r.size, perUnit: r.perUnit, lotStep: f.kind === 'lots' ? state.settings.lots.lotStep : 0, qtyStep: 0,
    contractSize: f.kind === 'lots' ? (num(f.contractSize) || 1) : 1, leverage: r.leverage || 1, notional: r.notional || null,
    risk: r.riskActual, base: f.instrument && f.instrument.base ? f.instrument.base : null,
    partials: [], doneSteps: [], slMoves: [], note: state.text.trim().slice(0, 500),
  };
  state.trades.unshift(trade); saveTrades(state.trades);
  state.manageId = trade.id; state.managePrice = '';
  updateOpenCount();
  showTab('manage');
  toast('Saved — enter the current price to manage it');
}

function updateOpenCount() {
  const n = state.trades.filter((t) => t.status === 'open').length;
  const b = $('openCount'); b.textContent = n; b.classList.toggle('hidden', n === 0);
}

/* ---------------------------------------------------------------- manage tab */
function renderManage() {
  const view = $('manageView');
  stopManageLive(); stopListLive();
  const t = state.manageId ? state.trades.find((x) => x.id === state.manageId) : null;
  if (t) renderTradeDetail(view, t); else renderTradeList(view);
}

function tradeTitle(t) {
  return `<span class="tsym">${esc(t.symbol)}</span><span class="tag ${t.direction === 'long' ? 'buy' : 'sell'}">${t.direction === 'long' ? 'BUY' : 'SELL'}</span>${t.status !== 'open' ? '<span class="tag grey">closed</span>' : ''}`;
}
function sizeLabel(t, size) {
  return t.kind === 'lots' ? `${fmtLots(size, t.lotStep || 0.01)} lots` : `${fmtQty(size)} ${t.base || ''}`.trim() + (t.kind === 'usdt' ? ` (${fmtMoney(size * t.entry, '', 0)} USDT)` : '');
}

function renderTradeList(view) {
  const open = state.trades.filter((t) => t.status === 'open');
  const closed = state.trades.filter((t) => t.status !== 'open');
  let html = '';
  if (!open.length && !closed.length) {
    html = `<div class="card"><div class="empty-state">No trades yet.<br><span class="small">Size a signal and tap <b>Save &amp; manage</b>. Then, whenever price moves, enter it here and SignalSize tells you what to sell and where to move the stop.</span></div></div>`;
  }
  const item = (t) => {
    const refs = [t.entry, t.sl, ...t.tps]; const rem = remainingSize(t); const c = cur();
    const done = (t.doneSteps || []).length; const plan = buildPlan(t, state.settings.plan);
    const pnl = realizedPnl(t);
    return `<div class="card tradecard" data-id="${t.id}"><div class="thead">${tradeTitle(t)}<span class="muted small" style="margin-left:auto">${new Date(t.createdAt).toLocaleDateString()}</span></div>
      <div class="tline">${sizeLabel(t, t.status === 'open' ? rem : t.size)} @ ${fmtPrice(t.entry, refs)} · SL ${fmtPrice(t.currentSl, refs)}${t.currentSl !== t.sl ? ' <span class="pos">(moved)</span>' : ''}${t.tps.length ? ` · TP ${t.tps.map((p) => fmtPrice(p, refs)).join(' / ')}` : ''}</div>
      <div class="tline">Risk ${fmtMoney(t.risk, c)} · ${done}/${plan.length} steps done${pnl ? ` · realized <span class="${pnl >= 0 ? 'pos' : 'neg'}">${fmtSigned(pnl, c)}</span>` : ''}${t.status !== 'open' && t.closePrice ? ` · closed @ ${fmtPrice(t.closePrice, refs)}` : ''}</div>${t.status === 'open' ? `<div class="tline" data-live-line="${t.id}"></div>` : ''}</div>`;
  };
  if (open.length) html += `<div class="section-title">Open (${open.length})</div>` + open.map(item).join('');
  if (closed.length) html += `<div class="section-title">History (${closed.length})</div>` + closed.slice(0, 30).map(item).join('');
  view.innerHTML = html;
  view.querySelectorAll('.tradecard').forEach((el) => el.addEventListener('click', () => { state.manageId = el.dataset.id; state.managePrice = ''; renderManage(); window.scrollTo({ top: 0 }); }));
  startListLive(open);
}

function renderTradeDetail(view, t) {
  const refs = [t.entry, t.sl, ...t.tps]; const c = cur();
  const rem = remainingSize(t);
  view.innerHTML = `
    <button class="link" id="btnBack">← All trades</button>
    <div class="card"><div class="thead">${tradeTitle(t)}</div>
      <div class="tline">Entry <b>${fmtPrice(t.entry, refs)}</b> · Stop <b>${fmtPrice(t.currentSl, refs)}</b>${t.currentSl !== t.sl ? ` <span class="muted">(was ${fmtPrice(t.sl, refs)})</span>` : ''}${t.tps.length ? ` · TP ${t.tps.map((p) => fmtPrice(p, refs)).join(' / ')}` : ''}</div>
      <div class="tline">Size <b>${sizeLabel(t, t.size)}</b>${rem !== t.size ? ` · remaining <b>${sizeLabel(t, rem)}</b>` : ''} · risk ${fmtMoney(t.risk, c)}${t.kind === 'usdt' && t.leverage > 1 ? ` · ${t.leverage}x` : ''}</div>
    </div>
    ${t.status === 'open' ? `<div class="card"><label for="mPrice">Current price</label>
      <input id="mPrice" type="text" inputmode="decimal" class="big-input" style="max-width:100%;width:100%" placeholder="what is ${esc(t.symbol)} trading at?" autocomplete="off" value="${esc(state.managePrice)}">
      <div class="chips small" id="mChips">${[['entry', t.entry], ...t.tps.map((p, i) => [`TP${i + 1}`, p]), ['stop', t.currentSl]].map(([l, v]) => `<button type="button" class="chip" data-v="${v}">${l} ${fmtPrice(v, refs)}</button>`).join('')}</div>
      <div id="mLiveStatus" class="live livestatus hidden"></div>
    </div>` : ''}
    <div id="mDynamic"></div>
    <div class="row wrap">
      ${t.status === 'open' ? '' : `<button class="btn tiny" id="btnReopen">Reopen</button>`}
      <button class="btn tiny danger" id="btnDelete">Delete trade</button>
    </div>`;
  $('btnBack').addEventListener('click', () => { state.manageId = null; renderManage(); });
  $('btnDelete').addEventListener('click', () => { if (confirm('Delete this trade?')) { state.trades = state.trades.filter((x) => x.id !== t.id); saveTrades(state.trades); state.manageId = null; updateOpenCount(); renderManage(); } });
  if ($('btnReopen')) $('btnReopen').addEventListener('click', () => { t.status = 'open'; delete t.closedAt; delete t.closePrice; if (t.partials.length && t.partials[t.partials.length - 1].final) t.partials.pop(); saveTrades(state.trades); updateOpenCount(); renderManage(); });
  if (t.status === 'open') {
    const inp = $('mPrice');
    inp.addEventListener('input', () => { state.managePrice = inp.value; pauseManageLive(); renderDynamic(t); });
    $('mChips').addEventListener('click', (e) => { const ch = e.target.closest('.chip'); if (!ch) return; state.managePrice = ch.dataset.v; inp.value = ch.dataset.v; pauseManageLive(); renderDynamic(t); });
    $('mLiveStatus').addEventListener('click', (e) => { if (e.target.closest('[data-resume]')) resumeManageLive(t); });
    startManageLive(t);
    if (!state.managePrice && state.mLive.status !== 'live' && !liveEnabled()) setTimeout(() => inp.focus(), 50);
  }
  renderDynamic(t);
}

function renderDynamic(t) {
  const box = $('mDynamic'); if (!box) return;
  const refs = [t.entry, t.sl, ...t.tps]; const c = cur();
  const plan = state.settings.plan;
  if (t.status !== 'open') {
    const pnl = realizedPnl(t);
    box.innerHTML = `<div class="card"><div class="status ${pnl >= 0 ? 'pos' : 'neg'}">${fmtSigned(pnl, c)}</div><div class="muted small">Closed ${t.closedAt ? new Date(t.closedAt).toLocaleString() : ''}${t.closePrice ? ` · last fill ${fmtPrice(t.closePrice, refs)}` : ''} · ${(pnl / Math.max(t.risk, 1e-9)).toFixed(2)}R</div>
      ${t.partials.length ? `<table class="tbl"><tr><th>Fill</th><th class="r">Size</th><th class="r">P&amp;L</th></tr>${t.partials.map((p) => `<tr><td>${fmtPrice(p.price, refs)}</td><td class="r">${sizeLabel(t, p.size)}</td><td class="r ${pnlOf(t, p) >= 0 ? 'pos' : 'neg'}">${fmtSigned(pnlOf(t, p), c)}</td></tr>`).join('')}</table>` : ''}</div>`;
    return;
  }
  const price = num(state.managePrice);
  const steps = buildPlan(t, plan);
  const done = new Set(t.doneSteps || []);
  const planTable = (a) => `<div class="card"><div class="card-title">Plan</div><table class="tbl plan"><tr><th>Level</th><th class="r">Price</th><th class="r">Sell</th><th class="r">Stop →</th></tr>
    ${steps.map((s) => { const st = a ? a.steps.find((x) => x.index === s.index) : null; const cls = done.has(s.index) ? 'done' : st && st.reached ? 'reached' : (a && a.next && a.next.label === s.label ? 'next' : ''); return `<tr class="${cls}"><td>${s.label}${s.synthetic ? '<span class="muted small"> auto</span>' : ''}<span class="sub">${s.r.toFixed(1)}R</span></td><td class="r">${fmtPrice(s.price, refs)}</td><td class="r">${s.stopOnly ? '<span class="muted">stop only</span>' : `${s.pct}%<span class="sub">${sizeLabel(t, s.size).split(' (')[0]}</span>`}</td><td class="r">${fmtPrice(s.slTo, refs)}<span class="sub">${esc(s.slLabel)}</span></td></tr>`; }).join('')}
    </table><div class="hint">Percentages are of the original size; the last level closes the rest. Change the rules in Settings.</div></div>`;
  if (!price) {
    box.innerHTML = `<div class="card action hold"><div class="atitle">Waiting for a price</div><div class="areason">Type the current price above and SignalSize tells you whether to take profit, move the stop, or hold.</div></div>` + planTable(null);
    return;
  }
  const a = assess(t, price, plan);
  const rTxt = a.r != null ? fmtR(a.r) : '—';
  let status = '';
  status += `<div class="card"><div class="kv">
    <span class="k">Now</span><span class="v"><b>${fmtPrice(price, refs)}</b> <span class="muted">(${fmtSigned(a.move, '')} · ${fmtPct(a.movePct)})</span></span>
    <span class="k">R multiple</span><span class="v ${a.r >= 0 ? 'pos' : 'neg'}"><b>${rTxt}</b></span>
    <span class="k">Open P&amp;L</span><span class="v ${a.openPnl >= 0 ? 'pos' : 'neg'}"><b>${fmtSigned(a.openPnl, c)}</b> <span class="muted">on ${sizeLabel(t, a.remaining).split(' (')[0]}</span></span>
    ${a.realized ? `<span class="k">Realized</span><span class="v ${a.realized >= 0 ? 'pos' : 'neg'}">${fmtSigned(a.realized, c)}</span>` : ''}
    <span class="k">Locked if stop hits</span><span class="v ${a.lockedPnl >= 0 ? 'pos' : 'neg'}">${fmtSigned(a.lockedPnl, c)}</span>
  </div></div>`;

  let action = '';
  const act = a.action;
  if (a.status === 'stopped') {
    action = `<div class="card action stop"><div class="atitle">Stop hit</div><div class="aline">Close the remaining ${sizeLabel(t, a.remaining)}</div><div class="areason">${esc(act.reason)} Result: <b>${fmtSigned(a.realized + pnlAtPrice(t, t.currentSl, a.remaining), c)}</b>.</div>
      <div class="row wrap"><button class="btn danger" data-act="stopped">Mark stopped out @ ${fmtPrice(t.currentSl, refs)}</button><button class="btn" data-act="closeall" data-price="${price}">Closed @ ${fmtPrice(price, refs)}</button></div></div>`;
  } else if (a.status === 'take_profit') {
    const sellTxt = act.type === 'close' ? `Close the rest: <span class="big">${sizeLabel(t, act.size)}</span>` : `Sell <span class="big">${sizeLabel(t, act.size)}</span> <span class="muted small">(${Math.round(act.pct * 100)}% of position)</span>`;
    action = `<div class="card action"><div class="atitle">${act.steps.join(' + ')} reached — take profit</div>
      <div class="aline">${sellTxt}</div>
      ${act.newSl != null ? `<div class="aline">Move stop to <span class="big">${fmtPrice(act.newSl, refs)}</span> <span class="muted small">(${esc(act.newSlLabel || '')})</span></div>` : ''}
      <div class="areason">${esc(act.reason)} Banks <b class="pos">${fmtSigned(pnlAtPrice(t, price, act.size), c)}</b> now${act.newSl != null ? `; the rest can no longer lose${pnlAtPrice(t, act.newSl, a.remaining - act.size) > 0.005 ? ` and keeps <b class="pos">${fmtSigned(pnlAtPrice(t, act.newSl, a.remaining - act.size), c)}</b> locked` : ''}` : ''}.</div>
      <div class="row wrap">
        <button class="btn good" data-act="sold" data-size="${act.size}" data-price="${price}" data-steps="${act.stepsIdx || a.steps.filter((s) => s.reached && !s.done).map((s) => s.index).join(',')}">✓ Sold ${sizeLabel(t, act.size).split(' (')[0]}</button>
        ${act.newSl != null ? `<button class="btn good" data-act="movesl" data-sl="${act.newSl}">✓ Stop moved to ${fmtPrice(act.newSl, refs)}</button>` : ''}
      </div></div>`;
  } else if (a.status === 'move_stop') {
    action = `<div class="card action"><div class="atitle">Tighten the stop</div><div class="aline">Move stop to <span class="big">${fmtPrice(act.newSl, refs)}</span> <span class="muted small">(${esc(act.newSlLabel || '')})</span></div><div class="areason">${esc(act.reason)}</div>
      <div class="row"><button class="btn good" data-act="movesl" data-sl="${act.newSl}">✓ Stop moved</button></div></div>`;
  } else if (a.status === 'drawdown') {
    action = `<div class="card action hold"><div class="atitle">In drawdown · ${rTxt}</div><div class="aline">Hold. Respect the stop at ${fmtPrice(t.currentSl, refs)}.</div><div class="areason">Nothing to do until price reaches ${a.next ? `${a.next.label} (${fmtPrice(a.next.price, refs)})` : 'a target'}. Don't add to the position and don't widen the stop.</div></div>`;
  } else {
    const n = a.next;
    action = `<div class="card action hold"><div class="atitle">In profit · ${rTxt} — hold</div>
      ${n ? `<div class="aline">Next: ${n.label} at <span class="big">${fmtPrice(n.price, refs)}</span> <span class="muted small">(${fmtPrice(n.distance, refs)} away)</span></div><div class="areason">There, ${n.pct ? `sell ${n.pct}% (${sizeLabel(t, n.size).split(' (')[0]}) and ` : ''}move the stop to ${fmtPrice(n.slTo, refs)} (${esc(n.slLabel)}).${a.remaining < t.size ? '' : ' Until then, keep the full position and the original stop.'}</div>` : `<div class="aline">All targets done.</div>`}
    </div>`;
  }
  if (a.alternatives.length) {
    action += `<div class="card"><div class="card-title">Other options right now</div><div class="alts">${a.alternatives.map((alt) => alt.type === 'move_sl'
      ? `<div class="alt"><div><div class="l">${esc(alt.label)} → stop ${fmtPrice(alt.newSl, refs)}</div><div class="m">locks ${fmtSigned(alt.locked, c)} if it hits</div></div><button class="btn tiny" data-act="movesl" data-sl="${alt.newSl}">Do it</button></div>`
      : `<div class="alt"><div><div class="l">${esc(alt.label)}</div><div class="m">total ${fmtSigned(alt.pnl, c)}</div></div><button class="btn tiny" data-act="closeall" data-price="${price}">Do it</button></div>`).join('')}</div></div>`;
  }
  box.innerHTML = status + action + planTable(a);
  box.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onManageAction(t, b.dataset, price)));
}

function pnlAtPrice(t, price, size) { const dir = t.direction === 'short' ? -1 : 1; return (price - t.entry) * dir * (t.perUnit || 1) * size; }
function pnlOf(t, p) { return pnlAtPrice(t, p.price, p.size); }

function onManageAction(t, d, price) {
  const c = cur(); const refs = [t.entry, t.sl, ...t.tps];
  if (d.act === 'sold') {
    const size = Math.min(Number(d.size), remainingSize(t)); const p = Number(d.price);
    if (!(size > 0)) return;
    t.partials.push({ price: p, size, at: Date.now() });
    const idx = (d.steps || '').split(',').filter((x) => x !== '').map(Number);
    t.doneSteps = [...new Set([...(t.doneSteps || []), ...idx])];
    if (remainingSize(t) <= 0) { t.status = 'closed'; t.closedAt = Date.now(); t.closePrice = p; t.partials[t.partials.length - 1].final = true; }
    saveTrades(state.trades); updateOpenCount();
    toast(`Recorded: sold ${sizeLabel(t, size).split(' (')[0]} @ ${fmtPrice(p, refs)} (${fmtSigned(pnlAtPrice(t, p, size), c)})`);
    if (t.status === 'closed') renderManage(); else renderDynamic(t);
  } else if (d.act === 'movesl') {
    const sl = Number(d.sl);
    t.slMoves.push({ from: t.currentSl, to: sl, at: Date.now() }); t.currentSl = sl;
    // stop-only plan steps satisfied by this move count as done
    const dir = t.direction === 'short' ? -1 : 1;
    for (const s of buildPlan(t, state.settings.plan)) if (s.stopOnly && (sl - s.slTo) * dir >= -1e-9 && (price - s.price) * dir >= 0) t.doneSteps = [...new Set([...(t.doneSteps || []), s.index])];
    saveTrades(state.trades);
    toast(`Stop now at ${fmtPrice(sl, refs)}`);
    renderManage(); // header shows the new stop
  } else if (d.act === 'closeall') {
    const p = Number(d.price); const size = remainingSize(t);
    if (size > 0) t.partials.push({ price: p, size, at: Date.now(), final: true });
    t.status = 'closed'; t.closedAt = Date.now(); t.closePrice = p;
    saveTrades(state.trades); updateOpenCount();
    toast(`Closed. Total ${fmtSigned(realizedPnl(t), c)}`);
    renderManage();
  } else if (d.act === 'stopped') {
    const size = remainingSize(t);
    if (size > 0) t.partials.push({ price: t.currentSl, size, at: Date.now(), final: true });
    t.status = 'closed'; t.closedAt = Date.now(); t.closePrice = t.currentSl;
    saveTrades(state.trades); updateOpenCount();
    toast(`Stopped out. Total ${fmtSigned(realizedPnl(t), c)}`);
    renderManage();
  }
}


/* ---------------------------------------------------------------- live prices */
function liveEnabled() { return (state.settings.live || {}).enabled !== false; }
function liveOpts() { const l = state.settings.live || {}; return { finnhubKey: (l.finnhubKey || '').trim(), allowApprox: l.allowApprox !== false }; }
function liveValueString(price, refs) { return String(Number(price.toFixed(priceDecimals(price, refs.filter((r) => r != null))))); }
function ageText(ts) { const s = Math.max(0, Math.round((Date.now() - ts) / 1000)); return s < 2 ? 'now' : `${s}s ago`; }

function renderLiveBadge() {
  const el = $('liveBadge'); const L = state.live; const f = state.form;
  if (!liveEnabled() || !f.instrument) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.className = `live is-${L.status}`;
  const refs = [num(f.entry), num(f.sl)];
  if (L.status === 'live' && L.price != null) {
    el.innerHTML = `<span class="dot"></span><span class="lp">${fmtPrice(L.price, refs)}</span><span>${L.approx ? '≈ ' : ''}live · ${esc(L.source || '')}</span><button type="button" class="chip" data-use="1">Use</button>`;
  } else if (L.status === 'connecting') el.innerHTML = `<span class="dot"></span><span>connecting to live price…</span>`;
  else if (L.status === 'offline') el.innerHTML = `<span class="dot"></span><span>offline — no live price</span>`;
  else el.innerHTML = `<span class="dot"></span><span>no live price for this market</span>`;
}

function syncFormLive() {
  const f = state.form; const L = state.live;
  const want = liveEnabled() && state.tab === 'size' && f.instrument ? f.instrument.symbol : null;
  if (L.symbol === want && (want ? !!L.sub : true)) { renderLiveBadge(); return; }
  stopFormLive();
  L.symbol = want; L.price = null; L.status = want ? 'connecting' : 'idle'; L.autoFilled = null;
  if (!want) { renderLiveBadge(); return; }
  L.sub = watchPrice(f.instrument, (ev) => {
    if (ev.type === 'price') {
      L.price = ev.price; L.source = ev.source; L.approx = ev.approx; L.status = 'live';
      // market-entry signals: fill the entry once from the live price
      if (!num(state.form.entry) && L.autoFilled !== want && document.activeElement !== $('fEntry')) {
        const v = liveValueString(ev.price, [num(state.form.sl)]);
        state.form.entry = v; $('fEntry').value = v; L.autoFilled = want;
        $('fEntry').classList.remove('invalid');
        const flags = $('parseFlags'); if (flags && !flags.querySelector('[data-live-fill]')) flags.insertAdjacentHTML('beforeend', `<div class="flag info" data-live-fill>Entry filled from the live price (${fmtPrice(ev.price, [ev.price])}). Change it if your fill was different.</div>`);
        compute();
      }
    } else { L.status = ev.status; L.source = ev.source; }
    renderLiveBadge();
  }, liveOpts());
  renderLiveBadge();
}
function stopFormLive() { const L = state.live; if (L.sub) { L.sub(); L.sub = null; } L.symbol = null; L.status = 'idle'; L.price = null; renderLiveBadge(); }

let manageRenderTimer = null;
function renderManageLiveStatus(t) {
  const el = $('mLiveStatus'); if (!el) return;
  const M = state.mLive; const refs = [t.entry, t.sl, ...t.tps];
  if (!liveEnabled()) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.className = `live livestatus is-${M.status}`;
  if (M.status === 'live' && M.price != null) {
    el.innerHTML = `<span class="dot"></span><span class="lp">${fmtPrice(M.price, refs)}</span><span>${M.approx ? '≈ ' : ''}live · ${esc(M.source || '')}</span>${M.paused ? '<button type="button" class="chip" data-resume="1">▶ Resume live</button>' : '<span class="muted">updating</span>'}`;
  } else if (M.status === 'connecting') el.innerHTML = `<span class="dot"></span><span>connecting to live price…</span>`;
  else if (M.status === 'offline') el.innerHTML = `<span class="dot"></span><span>offline — type the price</span>`;
  else el.innerHTML = `<span class="dot"></span><span>no live price for this market — type it</span>`;
}
function startManageLive(t) {
  stopManageLive();
  if (!liveEnabled()) return;
  const inst = instrumentForSymbol(t.symbol) || (t.base ? { symbol: t.symbol, kind: t.kind, base: t.base } : null);
  if (!inst) { state.mLive.status = 'unavailable'; renderManageLiveStatus(t); return; }
  const M = state.mLive; M.tradeId = t.id; M.paused = false; M.price = null; M.status = 'connecting';
  M.sub = watchPrice(inst, (ev) => {
    if (state.manageId !== t.id) return;
    if (ev.type === 'price') {
      M.price = ev.price; M.source = ev.source; M.approx = ev.approx; M.status = 'live';
      if (!M.paused) {
        const v = liveValueString(ev.price, [t.entry, t.sl, ...t.tps]);
        if (state.managePrice !== v) {
          state.managePrice = v; const inp = $('mPrice'); if (inp && document.activeElement !== inp) inp.value = v;
          if (!manageRenderTimer) manageRenderTimer = setTimeout(() => { manageRenderTimer = null; const cur = state.trades.find((x) => x.id === state.manageId); if (cur) renderDynamic(cur); }, 400);
        }
      }
    } else { M.status = ev.status; M.source = ev.source; }
    renderManageLiveStatus(t);
  }, liveOpts());
  renderManageLiveStatus(t);
}
function stopManageLive() { const M = state.mLive; if (M.sub) { M.sub(); M.sub = null; } M.tradeId = null; M.status = 'idle'; M.price = null; M.paused = false; clearTimeout(manageRenderTimer); manageRenderTimer = null; }
function pauseManageLive() { const M = state.mLive; if (M.sub && !M.paused) { M.paused = true; const t = state.trades.find((x) => x.id === state.manageId); if (t) renderManageLiveStatus(t); } }
function resumeManageLive(t) {
  const M = state.mLive; M.paused = false;
  if (M.price != null) { const v = liveValueString(M.price, [t.entry, t.sl, ...t.tps]); state.managePrice = v; const inp = $('mPrice'); if (inp) inp.value = v; renderDynamic(t); }
  renderManageLiveStatus(t);
}

function startListLive(openTrades) {
  stopListLive();
  if (!liveEnabled()) return;
  const bySymbol = new Map();
  for (const t of openTrades) { const inst = instrumentForSymbol(t.symbol); if (inst) { if (!bySymbol.has(inst.symbol)) bySymbol.set(inst.symbol, { inst, trades: [] }); bySymbol.get(inst.symbol).trades.push(t); } }
  for (const { inst, trades } of bySymbol.values()) {
    state.listSubs.push(watchPrice(inst, (ev) => {
      if (ev.type !== 'price') return;
      for (const t of trades) {
        const el = document.querySelector(`[data-live-line="${t.id}"]`); if (!el) continue;
        const a = assess(t, ev.price, state.settings.plan); const refs = [t.entry, t.sl, ...t.tps];
        el.innerHTML = `<span class="lp">${fmtPrice(ev.price, refs)}</span> ${ev.approx ? '≈ ' : ''}live · <span class="${a.openPnl >= 0 ? 'pos' : 'neg'}">${fmtSigned(a.openPnl, cur())}</span> · ${fmtR(a.r)}${a.status === 'take_profit' ? ' · <span class="gold">take profit!</span>' : a.status === 'stopped' ? ' · <span class="neg">stop hit</span>' : ''}`;
      }
    }, liveOpts()));
  }
}
function stopListLive() { for (const u of state.listSubs) { try { u(); } catch { /* ignore */ } } state.listSubs = []; }
function stopAllLive() { stopFormLive(); stopManageLive(); stopListLive(); stopAllPrices(); }
function resumeLiveForView() {
  if (state.tab === 'size') syncFormLive();
  if (state.tab === 'manage') renderManage();
}

/* ---------------------------------------------------------------- settings */
function bindSettingsTab() {
  const s = state.settings;
  const bindNum = (id, get, set, opts = {}) => {
    $(id).addEventListener('change', () => {
      const v = num($(id).value);
      if (v == null || v < (opts.min ?? 0)) { $(id).value = get() ?? ''; return; }
      set(v); saveSettings(s); afterSettingsChange();
    });
  };
  bindNum('sBalance', () => s.balance, (v) => { s.balance = v; });
  bindNum('sRiskPct', () => s.riskPct, (v) => { s.riskPct = v; });
  bindNum('sContract', () => s.lots.contractSize, (v) => { s.lots.contractSize = v; if (state.form.symbol === 'XAUUSD' || !state.form.symbol) { state.form.contractSize = String(v); $('fContract').value = String(v); } }, { min: 0.000001 });
  bindNum('sLotStep', () => s.lots.lotStep, (v) => { s.lots.lotStep = v; }, { min: 0.000001 });
  bindNum('sMinLot', () => s.lots.minLot, (v) => { s.lots.minLot = v; }, { min: 0 });
  bindNum('sMaxLot', () => s.lots.maxLot, (v) => { s.lots.maxLot = v; });
  bindNum('sCommission', () => s.lots.commissionPerLot, (v) => { s.lots.commissionPerLot = v; });
  bindNum('sLeverage', () => s.crypto.leverage, (v) => { s.crypto.leverage = Math.max(1, Math.round(v)); }, { min: 1 });
  bindNum('sFee', () => s.crypto.feePct, (v) => { s.crypto.feePct = v; state.form.feePct = String(v); $('fFee').value = String(v); });
  bindNum('sP1', () => s.plan.partials[0], (v) => { s.plan.partials[0] = v; });
  bindNum('sP2', () => s.plan.partials[1], (v) => { s.plan.partials[1] = v; });
  bindNum('sP3', () => s.plan.partials[2], (v) => { s.plan.partials[2] = v; });
  bindNum('sBeBuffer', () => s.plan.beBufferPct, (v) => { s.plan.beBufferPct = v; });
  bindNum('sLockPct', () => s.plan.lockPct, (v) => { s.plan.lockPct = Math.min(95, v); }, { min: 1 });
  $('sCurrency').addEventListener('change', () => { s.currency = $('sCurrency').value.trim() || '$'; saveSettings(s); afterSettingsChange(); });
  $('sPresets').addEventListener('change', () => { s.riskPresets = $('sPresets').value.split(/[\s,]+/).map(num).filter((v) => v != null && v > 0).slice(0, 8); saveSettings(s); afterSettingsChange(); });
  $('sIncludeFees').addEventListener('change', () => { s.crypto.includeFees = $('sIncludeFees').checked; saveSettings(s); afterSettingsChange(); });
  $('sBeAt').addEventListener('change', () => { s.plan.beAt = $('sBeAt').value; saveSettings(s); afterSettingsChange(); });
  $('sTrail').addEventListener('change', () => { s.plan.trail = $('sTrail').value; saveSettings(s); afterSettingsChange(); });
  $('sLiveEnabled').addEventListener('change', () => { s.live.enabled = $('sLiveEnabled').checked; saveSettings(s); stopAllLive(); afterSettingsChange(); });
  $('sFinnhubKey').addEventListener('change', () => { s.live.finnhubKey = $('sFinnhubKey').value.trim(); saveSettings(s); stopAllLive(); afterSettingsChange(); });
  $('sAllowApprox').addEventListener('change', () => { s.live.allowApprox = $('sAllowApprox').checked; saveSettings(s); stopAllLive(); afterSettingsChange(); });
  $('btnOcrPack').addEventListener('click', async () => {
    const b = $('btnOcrPack'); b.disabled = true;
    try { await downloadOcrPack((p) => { $('ocrPackStatus').textContent = `Downloading… ${Math.round(p * 100)}%`; }); toast('Screenshot reading works offline now'); } catch (e) { toast('Download failed — check your connection'); }
    b.disabled = false; refreshOcrPackStatus();
  });
  $('btnExport').addEventListener('click', () => {
    const blob = new Blob([exportAll()], { type: 'application/json' }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `signalsize-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const res = importAll(await f.text()); state.settings = loadSettings(); state.trades = loadTrades(); renderSettingsForm(); afterSettingsChange(); updateOpenCount(); toast(`Imported ${res.trades} trades`); } catch (err) { toast(`Import failed: ${err.message}`); }
    e.target.value = '';
  });
  $('btnWipe').addEventListener('click', () => { if (confirm('Erase all settings and trades on this device?')) { clearAll(); location.reload(); } });
}

function afterSettingsChange() {
  $('curSym').textContent = cur();
  renderRiskChips(); syncRiskPct(); compute();
  if (state.tab === 'manage') renderManage();
  if (state.tab === 'size') syncFormLive();
}

function renderSettingsForm() {
  const s = state.settings;
  $('sBalance').value = s.balance || ''; $('sCurrency').value = s.currency || '$'; $('sRiskPct').value = s.riskPct ?? ''; $('sPresets').value = (s.riskPresets || []).join(', ');
  $('sContract').value = s.lots.contractSize; $('sLotStep').value = s.lots.lotStep; $('sMinLot').value = s.lots.minLot; $('sMaxLot').value = s.lots.maxLot || 0; $('sCommission').value = s.lots.commissionPerLot || 0;
  $('sLeverage').value = s.crypto.leverage || 1; $('sFee').value = s.crypto.feePct ?? ''; $('sIncludeFees').checked = !!s.crypto.includeFees;
  $('sP1').value = s.plan.partials[0] ?? ''; $('sP2').value = s.plan.partials[1] ?? ''; $('sP3').value = s.plan.partials[2] ?? '';
  $('sBeAt').value = s.plan.beAt || 'tp1'; $('sBeBuffer').value = s.plan.beBufferPct || 0; $('sTrail').value = s.plan.trail || 'prevtp'; $('sLockPct').value = s.plan.lockPct || 50;
  $('sLiveEnabled').checked = (s.live || {}).enabled !== false; $('sFinnhubKey').value = (s.live || {}).finnhubKey || ''; $('sAllowApprox').checked = (s.live || {}).allowApprox !== false;
  renderInstallHelp();
}

async function refreshOcrPackStatus() {
  const el = $('ocrPackStatus'); const b = $('btnOcrPack');
  const ok = await ocrPackCached();
  el.textContent = ok ? 'Ready offline (≈7 MB cached on this device)' : (navigator.onLine ? 'Not cached yet — download once (≈7 MB) to read screenshots offline' : 'Not cached — connect to the internet to download');
  b.textContent = ok ? 'Re-download' : 'Download';
  b.disabled = !navigator.onLine;
}

/* ---------------------------------------------------------------- PWA */
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }

function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredInstall = e; $('btnInstall').classList.remove('hidden'); renderInstallHelp(); });
  $('btnInstall').addEventListener('click', async () => { const p = state.deferredInstall; if (!p) return; p.prompt(); await p.userChoice; state.deferredInstall = null; $('btnInstall').classList.add('hidden'); });
  window.addEventListener('appinstalled', () => { toast('Installed — open SignalSize from your home screen'); $('btnInstall').classList.add('hidden'); renderInstallHelp(); });
}

function renderInstallHelp() {
  const el = $('installHelp'); if (!el) return;
  if (isStandalone()) { el.innerHTML = 'Installed as an app ✓'; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (ios) el.innerHTML = '<b>Add to Home Screen:</b> tap the Share button in Safari, then “Add to Home Screen”. SignalSize then opens full-screen and works offline.';
  else if (state.deferredInstall) el.innerHTML = '<b>Install:</b> tap the Install button at the top to add SignalSize to your home screen.';
  else el.innerHTML = '<b>Add to Home Screen:</b> open the browser menu (⋮) and choose “Add to Home screen” / “Install app”.';
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      state.swReg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(reg); });
      });
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) return; refreshing = true; if (state._updateAccepted) location.reload(); });
      if (!navigator.serviceWorker.controller) setTimeout(() => refreshOcrPackStatus(), 3000);
    } catch (e) { console.warn('SW registration failed', e); }
  });
}

function promptUpdate(reg) {
  toast('Update ready — tap to reload', { ms: 15000, action: () => { state._updateAccepted = true; if (reg.waiting) reg.waiting.postMessage('skipWaiting'); else location.reload(); } });
}

async function handleUrlParams() {
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab'); if (tab && ['size', 'manage', 'settings'].includes(tab)) showTab(tab);
  if (params.get('shared') === '1') {
    try {
      const cache = await caches.open('signalsize-share'); const base = new URL('./', location.href).href;
      const tRes = await cache.match(`${base}shared-text`);
      if (tRes) { const txt = await tRes.text(); if (txt.trim()) setText(txt); await cache.delete(`${base}shared-text`); }
      const iRes = await cache.match(`${base}shared-image`);
      if (iRes) { const blob = await iRes.blob(); await cache.delete(`${base}shared-image`); handleImage(blob); }
    } catch (e) { console.warn(e); }
  }
  if (params.toString()) history.replaceState(null, '', location.pathname);
}

init();
