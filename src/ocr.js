// Offline OCR via vendored Tesseract.js. Everything is lazy: nothing loads until the first image.

const VENDOR = new URL('../vendor/', import.meta.url).href;
export const OCR_FILES = {
  lib: `${VENDOR}tesseract/tesseract.esm.min.js`,
  worker: `${VENDOR}tesseract/worker.min.js`,
  coreDir: `${VENDOR}tesseract/`,
  lang: `${VENDOR}tessdata/eng.traineddata.gz`,
};

const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const RELAXED = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);

/** Same selection logic as the Tesseract.js worker (LSTM-only cores). */
export function coreFileName() {
  try {
    if (WebAssembly.validate(RELAXED)) return 'tesseract-core-relaxedsimd-lstm.wasm.js';
    if (WebAssembly.validate(SIMD)) return 'tesseract-core-simd-lstm.wasm.js';
  } catch { /* fall through */ }
  return 'tesseract-core-lstm.wasm.js';
}

export function ocrPackUrls() {
  return [OCR_FILES.lib, OCR_FILES.worker, OCR_FILES.coreDir + coreFileName(), OCR_FILES.lang];
}

/** True when every OCR asset is already in the service-worker cache (works fully offline). */
export async function ocrPackCached() {
  if (!('caches' in window)) return false;
  try {
    const results = await Promise.all(ocrPackUrls().map((u) => caches.match(u, { ignoreSearch: true })));
    return results.every(Boolean);
  } catch { return false; }
}

/** Fetch the OCR assets so the service worker caches them. */
export async function downloadOcrPack(onProgress) {
  const urls = ocrPackUrls();
  let done = 0;
  for (const u of urls) {
    const r = await fetch(u, { cache: 'force-cache' });
    if (!r.ok) throw new Error(`Failed to fetch ${u}`);
    await r.arrayBuffer();
    done++;
    if (onProgress) onProgress(done / urls.length);
  }
}

let workerPromise = null;
let listeners = new Set();

function emit(m) { for (const l of listeners) l(m); }

async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const mod = await import(OCR_FILES.lib);
    const createWorker = mod.createWorker || (mod.default && mod.default.createWorker);
    const worker = await createWorker('eng', 1, {
      workerPath: OCR_FILES.worker,
      corePath: OCR_FILES.coreDir,
      langPath: `${VENDOR}tessdata`,
      workerBlobURL: false,
      logger: (m) => emit(m),
    });
    await worker.setParameters({ preserve_interword_spaces: '1' });
    return worker;
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

/** Load the engine ahead of time (call on idle after the first paint). */
export function warmOcr() { getWorker().catch(() => {}); }

/**
 * Preprocess for OCR: downscale huge photos, upscale small crops, grayscale,
 * auto-invert dark themes, and stretch contrast. Returns a canvas.
 */
export async function preprocess(blob) {
  const bmp = await createImageBitmap(blob);
  let { width, height } = bmp;
  let scale = 1;
  if (width < 1100) scale = Math.min(3, 1100 / width);
  if (width * scale > 2200) scale = 2200 / width;
  const w = Math.round(width * scale); const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  let sum = 0;
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const g = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
    gray[i] = g; sum += g; hist[g | 0]++;
  }
  const mean = sum / n;
  const invert = mean < 120;
  // contrast stretch between 2nd and 98th percentile
  let lo = 0; let hi = 255; let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let g = ((gray[i] - lo) * 255) / range;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (invert) g = 255 - g;
    d[j] = d[j + 1] = d[j + 2] = g; d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Recognize text in an image Blob/File. onProgress receives { status, progress }.
 * Returns { text, confidence, ms }.
 */
export async function recognizeImage(blob, onProgress) {
  const t0 = performance.now();
  const listener = (m) => { if (onProgress) onProgress(m); };
  listeners.add(listener);
  try {
    if (onProgress) onProgress({ status: 'preparing image', progress: 0 });
    const canvas = await preprocess(blob);
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas);
    return { text: data.text || '', confidence: data.confidence, ms: Math.round(performance.now() - t0) };
  } finally {
    listeners.delete(listener);
  }
}
