/**
 * Builds every bundle and assembles the unpacked extension in dist/.
 *
 *   popup      -> dist/popup/index.html (+ assets)
 *   bridge     -> dist/content/bridge.js   (isolated world, IIFE)
 *   inject     -> dist/content/inject.js   (MAIN world, IIFE)
 *   background -> dist/background.js       (service worker, IIFE)
 *
 * Static assets (manifest, icons, models, MediaPipe wasm) are copied last.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(rootDir, 'dist');
const viteBin = resolve(rootDir, 'node_modules/vite/bin/vite.js');

rmSync(distDir, { recursive: true, force: true });

const targets = ['popup', 'bridge', 'inject', 'background'];
for (const target of targets) {
  console.log(`\n[build] ${target}`);
  const result = spawnSync(process.execPath, [viteBin, 'build', '--logLevel', 'warn'], {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env, LG_TARGET: target },
  });
  if (result.status !== 0) {
    console.error(`[build] ${target} failed`);
    process.exit(result.status ?? 1);
  }
}

console.log('\n[build] static assets');

cpSync(resolve(rootDir, 'manifest.json'), resolve(distDir, 'manifest.json'));
cpSync(resolve(rootDir, 'assets/icons'), resolve(distDir, 'icons'), {
  recursive: true,
});
cpSync(resolve(rootDir, 'assets/models'), resolve(distDir, 'models'), {
  recursive: true,
});

const wasmSource = resolve(
  rootDir,
  'node_modules/@mediapipe/tasks-vision/wasm',
);
const wasmTarget = resolve(distDir, 'mediapipe/wasm');
mkdirSync(wasmTarget, { recursive: true });
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  const source = resolve(wasmSource, file);
  if (!existsSync(source)) {
    console.error(`[build] missing MediaPipe runtime file: ${source}`);
    process.exit(1);
  }
  cpSync(source, resolve(wasmTarget, file));
}

console.log(`\n[build] done -> ${distDir}`);
console.log('[build] load it with chrome://extensions -> Load unpacked');
