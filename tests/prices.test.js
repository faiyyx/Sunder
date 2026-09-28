import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourcesFor } from '../src/prices.js';
import { detectInstrument } from '../src/instruments.js';

test('crypto symbols map to exchange feeds, Binance first', () => {
  const s = sourcesFor(detectInstrument('BTC/USDT long'));
  assert.equal(s[0].id, 'binance');
  assert.equal(s[0].symbol, 'BTCUSDT');
  assert.ok(s.some((x) => x.id === 'bybit' && x.symbol === 'BTCUSDT'));
  assert.ok(s.some((x) => x.id === 'okx' && x.symbol === 'BTC-USDT'));
  assert.ok(s.some((x) => x.id === 'coinbase' && x.symbol === 'BTC-USD'));
  assert.ok(s.every((x) => !x.approx));
});

test('1000-prefixed perps skip Binance spot', () => {
  const s = sourcesFor(detectInstrument('1000PEPEUSDT long'));
  assert.equal(s[0].id, 'binance-futures');
  assert.equal(s[0].symbol, '1000PEPEUSDT');
});

test('gold: exact feeds first, tokenised gold marked approximate, Finnhub only with a key', () => {
  const noKey = sourcesFor(detectInstrument('XAUUSD buy'));
  assert.equal(noKey[0].id, 'swissquote');
  assert.equal(noKey[0].symbol, 'XAU/USD');
  assert.ok(noKey.some((x) => x.id === 'goldapi' && x.symbol === 'XAU'));
  const approx = noKey.filter((x) => x.approx);
  assert.ok(approx.length >= 2);
  assert.ok(approx.every((x, i) => noKey.indexOf(x) > noKey.findIndex((y) => y.id === 'goldapi')));
  const withKey = sourcesFor(detectInstrument('GOLD sell'), { finnhubKey: 'abc' });
  assert.equal(withKey[0].id, 'finnhub');
  assert.equal(withKey[0].symbol, 'OANDA:XAU_USD');
  const strict = sourcesFor(detectInstrument('XAUUSD buy'), { allowApprox: false });
  assert.ok(strict.every((x) => !x.approx));
});

test('forex pairs use OANDA via Finnhub or Swissquote', () => {
  const s = sourcesFor(detectInstrument('EURUSD buy'), { finnhubKey: 'k' });
  assert.deepEqual(s.map((x) => x.symbol), ['OANDA:EUR_USD', 'EUR/USD']);
  const jpy = sourcesFor(detectInstrument('USDJPY sell'));
  assert.deepEqual(jpy.map((x) => x.id), ['swissquote']);
});

test('indices have no free live source', () => {
  assert.deepEqual(sourcesFor(detectInstrument('US30 buy')), []);
  assert.deepEqual(sourcesFor(null), []);
});
