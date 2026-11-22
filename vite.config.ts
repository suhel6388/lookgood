import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const target = process.env.LG_TARGET ?? 'popup';

const ENTRIES: Record<string, { entry: string; fileName: string; name: string }> = {
  bridge: {
    entry: 'src/content/bridge.ts',
    fileName: 'content/bridge.js',
    name: 'LookGoodBridge',
  },
  inject: {
    entry: 'src/content/inject.ts',
    fileName: 'content/inject.js',
    name: 'LookGoodInject',
  },
  background: {
    entry: 'src/background/index.ts',
    fileName: 'background.js',
    name: 'LookGoodBackground',
  },
};

export default defineConfig(() => {
  if (target === 'popup') {
    const popupRoot = resolve(rootDir, 'src/popup');
    return {
      root: popupRoot,
      base: './',
      publicDir: false as const,
      plugins: [react(), tailwindcss()],
      build: {
        outDir: resolve(rootDir, 'dist/popup'),
        emptyOutDir: true,
        target: 'chrome116',
        rollupOptions: {
          input: resolve(popupRoot, 'index.html'),
        },
      },
    };
  }

  const spec = ENTRIES[target];
  if (!spec) throw new Error(`Unknown LG_TARGET "${target}"`);

  return {
    publicDir: false as const,
    build: {
      outDir: resolve(rootDir, 'dist'),
      emptyOutDir: false,
      target: 'chrome116',
      // The content scripts run in the page's MAIN world and the service worker
      // runs as a classic script, so every entry must be a single IIFE file.
      lib: {
        entry: resolve(rootDir, spec.entry),
        formats: ['iife' as const],
        name: spec.name,
        fileName: () => spec.fileName,
      },
      rollupOptions: {
        output: {
          extend: true,
        },
      },
    },
  };
});
