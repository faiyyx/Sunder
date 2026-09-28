#!/usr/bin/env node
// Builds the deployable site into dist/: copies the static files and stamps the build id
// into the service worker (cache version) and the app (version label). No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

let build = process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_REF || process.env.GITHUB_SHA || process.env.BUILD_ID || '';
if (!build) {
  try { build = execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { build = Date.now().toString(36); }
}
build = build.slice(0, 7);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
for (const f of ['index.html', 'styles.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'src', 'icons', 'vendor']) {
  fs.cpSync(path.join(root, f), path.join(dist, f), { recursive: true });
}
for (const f of ['sw.js', 'app.js']) {
  const p = path.join(dist, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('__BUILD__', build));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log(`Built dist/ (build ${build})`);
