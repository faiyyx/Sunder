/* SignalSize service worker: offline-first app shell + best-effort OCR pack + share target. */
const BUILD = '__BUILD__'; // replaced at deploy time with the commit hash
const SHELL_CACHE = `signalsize-shell-${BUILD}`;
const OCR_CACHE = 'signalsize-ocr-v7.0.0'; // bump when vendor/ changes
const SHARE_CACHE = 'signalsize-share';

const SHELL = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './src/instruments.js', './src/parser.js', './src/calc.js', './src/manage.js', './src/format.js', './src/store.js', './src/ocr.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png', './icons/icon.svg',
];

const SIMD = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);
const RELAXED = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253, 128, 2, 11]);
function coreFile() {
  try {
    if (WebAssembly.validate(RELAXED)) return 'tesseract-core-relaxedsimd-lstm.wasm.js';
    if (WebAssembly.validate(SIMD)) return 'tesseract-core-simd-lstm.wasm.js';
  } catch (e) { /* ignore */ }
  return 'tesseract-core-lstm.wasm.js';
}
const OCR_FILES = ['./vendor/tesseract/tesseract.esm.min.js', './vendor/tesseract/worker.min.js', `./vendor/tesseract/${coreFile()}`, './vendor/tessdata/eng.traineddata.gz'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    // OCR pack: best effort, never blocks install.
    try {
      const ocr = await caches.open(OCR_CACHE);
      await Promise.all(OCR_FILES.map(async (u) => {
        if (await ocr.match(u)) return;
        try { const r = await fetch(u); if (r.ok) await ocr.put(u, r); } catch (e) { /* offline or blocked */ }
      }));
    } catch (e) { /* ignore */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => (k.startsWith('signalsize-shell-') && k !== SHELL_CACHE) || (k.startsWith('signalsize-ocr-') && k !== OCR_CACHE)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Web Share Target (Android): stash the shared image/text, then open the app.
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      try {
        const fd = await req.formData();
        const cache = await caches.open(SHARE_CACHE);
        const file = fd.get('image');
        const text = [fd.get('title'), fd.get('text'), fd.get('url')].filter((x) => typeof x === 'string' && x.trim()).join('\n');
        if (file && file.size) await cache.put(new URL('./shared-image', self.registration.scope).href, new Response(file, { headers: { 'Content-Type': file.type || 'image/png' } }));
        else await cache.delete(new URL('./shared-image', self.registration.scope).href);
        await cache.put(new URL('./shared-text', self.registration.scope).href, new Response(text, { headers: { 'Content-Type': 'text/plain' } }));
      } catch (e) { /* ignore */ }
      return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Vendor (OCR) assets: cache-first, long-lived.
  if (url.pathname.includes('/vendor/')) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // App shell: cache-first, fall back to network; navigations fall back to index.html.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === 'navigate') {
        const index = await cache.match('./index.html', { ignoreSearch: true });
        if (index) return index;
      }
      throw e;
    }
  })());
});
