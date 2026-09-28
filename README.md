# Sunder

**Paste a trading signal → get the exact size → manage the trade.** An installable, offline web app.

- **Text, screenshot, or both.** Paste the signal text or drop in a screenshot (the reader runs on your phone, no internet needed). Sunder finds the symbol, direction, entry, stop loss, targets and leverage.
- **Gold / forex / indices → lot size.** Tell it how much you're willing to lose if the stop hits; it returns lots, rounded *down* to your broker's lot step, plus the real risk at that size.
- **Crypto → USDT amount.** Returns how much USDT to buy (notional), the coin quantity, the margin with leverage, and warns when liquidation would come before your stop.
- **Trade management.** Save the trade, then enter the current price whenever it moves: Sunder tells you how much to sell, when to move the stop to breakeven, and where to trail it after each target. It tracks partials, so the next recommendation accounts for what you already sold.
- **Offline, fast, private.** No accounts, no servers — everything stays on the device. Add it to your home screen and it opens like a native app.

## Install on your phone

The app must be served over HTTPS. The easiest way is GitHub Pages:

1. Merge this branch into `main`.
2. In the repository settings open **Pages** and set **Source** to **GitHub Actions** (one-time).
3. The `Deploy to GitHub Pages` workflow publishes the app at `https://<your-user>.github.io/Sunder/`.
4. Open that URL on your phone:
   - **iPhone:** Safari → Share → **Add to Home Screen**.
   - **Android:** Chrome → ⋮ menu → **Add to Home screen** / **Install app**. Screenshots can then be sent to Sunder straight from the share sheet.

Everything (including the ~7 MB screenshot reader) is cached on first use, so it keeps working with no connection.

## Run locally

```bash
npm test        # engine tests (parser, sizing, management)
npm run serve   # http://localhost:8080
```

No build step, no dependencies. `vendor/` holds Tesseract.js (Apache-2.0) and the English OCR model.

## How the math works

**Lots:** `lots = risk ÷ (|entry − stop| × contract size × quote→USD rate + commission)`, floored to the lot step. Gold: 1 lot = 100 oz, so a $1 move = $100 per lot.

**USDT:** `notional = risk ÷ (|entry − stop| ÷ entry + 2 × fee)`; `quantity = notional ÷ entry`; `margin = notional ÷ leverage`.

**Management plan (default, editable in Settings):** sell 50% at TP1 and move the stop to breakeven; sell 30% at TP2 and trail the stop to TP1; close the rest at TP3. With no targets in the signal it uses 1R / 2R / 3R. At any price it also offers alternatives: lock a percentage of the open profit, go to breakeven now, or close everything.

## Project layout

```
index.html  styles.css  app.js     UI (vanilla JS, ES modules)
src/parser.js                      signal text → structured fields (handles OCR noise)
src/instruments.js                 symbol detection and contract defaults
src/calc.js                        lot / USDT sizing
src/manage.js                      partial-exit plan and live assessment
src/ocr.js                         offline OCR (Tesseract.js) with image preprocessing
src/store.js                       localStorage persistence, backup import/export
sw.js  manifest.webmanifest        offline cache, install, Android share target
tests/                             node:test suites
```

Not financial advice. Always double-check the size with your broker or exchange before placing an order.
