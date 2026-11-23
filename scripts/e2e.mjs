/**
 * End-to-end smoke test: launches a Chromium browser with the unpacked
 * extension, a deterministic fake camera and the local test page, then checks
 * that the page receives a hooked stream and that the shader effects actually
 * change the pixels.
 *
 *   npm run e2e
 *
 * Env:
 *   BROWSER_PATH  override the Chromium executable
 *   HEADED=1      force a visible browser window
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { writeFakeCamera } from './fake-camera.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(rootDir, 'dist');
const artifactsDir = resolve(rootDir, '.artifacts');
const PORT = 5174;
const ORIGIN = `http://localhost:${PORT}`;
const SETTINGS_KEY = 'lookgood:settings';

const BASE_SETTINGS = {
  masterEnabled: true,
  skinSmoothing: 0,
  colorCorrection: 0,
  lightCorrection: 0,
  sharpening: 0,
  portraitLighting: 0,
  backgroundBlur: 0,
  watermark: false,
  targetFps: 30,
  aiFps: 15,
  showStats: false,
};

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) {
  console.error('No Chromium-based browser found. Set BROWSER_PATH.');
  process.exit(1);
}

if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}

mkdirSync(artifactsDir, { recursive: true });
const fakeCameraPath = writeFakeCamera(
  join(artifactsDir, 'fake-camera.y4m'),
).replaceAll('\\', '/');

const failures = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
}

async function waitForServer(timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(ORIGIN);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  throw new Error('test server did not start');
}

async function launch(headless) {
  const profile = mkdtempSync(join(tmpdir(), 'lookgood-e2e-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath,
    headless,
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${fakeCameraPath}`,
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DialMediaRouteProvider',
    ],
    viewport: { width: 1280, height: 900 },
  });
  return { context, profile };
}

async function getExtensionId(context, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const worker of context.serviceWorkers()) {
      const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.url());
      if (match) return match[1];
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  return null;
}

/** Writes settings through the service worker so the test tab stays focused. */
async function applySettings(worker, patch, page) {
  await worker.evaluate(
    async ({ key, base, patch: next }) => {
      const stored = await chrome.storage.sync.get(key);
      await chrome.storage.sync.set({
        [key]: { ...(stored[key] ?? {}), ...base, ...next },
      });
    },
    { key: SETTINGS_KEY, base: BASE_SETTINGS, patch },
  );
  await page.bringToFront();
  await page.waitForTimeout(500);
}

/** Average colour and luma contrast of three regions of the delivered frame. */
async function sampleFrame(page) {
  return page.evaluate(() => {
    const video = document.getElementById('video');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);

    const region = (fx, fy, fw, fh) => {
      const x = Math.floor(fx * canvas.width);
      const y = Math.floor(fy * canvas.height);
      const w = Math.max(2, Math.floor(fw * canvas.width));
      const h = Math.max(2, Math.floor(fh * canvas.height));
      const data = ctx.getImageData(x, y, w, h).data;
      const lumas = [];
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        lumas.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      }
      const count = lumas.length;
      const mean = lumas.reduce((sum, value) => sum + value, 0) / count;
      const variance =
        lumas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
      return {
        r: r / count,
        g: g / count,
        b: b / count,
        luma: mean / 255,
        contrast: Math.sqrt(variance) / 255,
      };
    };

    return {
      width: canvas.width,
      height: canvas.height,
      red: region(0.05, 0.05, 0.2, 0.25),
      gray: region(0.53, 0.6, 0.17, 0.25),
      texture: region(0.78, 0.6, 0.2, 0.25),
      stats: region(0.0, 0.0, 0.35, 0.09),
      corner: region(0.62, 0.8, 0.36, 0.18),
    };
  });
}

async function main() {
  const server = spawn(
    process.execPath,
    [resolve(rootDir, 'scripts/serve-test.mjs')],
    { stdio: 'ignore' },
  );

  let context;
  let profile;
  try {
    await waitForServer();
    const headed = process.env.HEADED === '1';
    ({ context, profile } = await launch(!headed));

    const page = await context.newPage();
    const pageErrors = [];
    const collectError = (text) => {
      if (/favicon|404 \(Not Found\)/.test(text)) return;
      // MediaPipe writes its startup diagnostics to console.error as INFO lines.
      if (/^INFO: /.test(text)) return;
      pageErrors.push(text);
    };
    page.on('pageerror', (error) => collectError(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') collectError(message.text());
    });

    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
    await context.grantPermissions(['camera', 'microphone'], { origin: ORIGIN });

    let extensionId = await getExtensionId(context);
    if (!extensionId && !headed) {
      // Some Chromium builds only enable extensions in headed mode.
      await context.close();
      rmSync(profile, { recursive: true, force: true });
      console.log('[e2e] headless had no service worker, retrying headed');
      ({ context, profile } = await launch(false));
      const headedPage = await context.newPage();
      await headedPage.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
      extensionId = await getExtensionId(context);
    }

    check('extension service worker is running', Boolean(extensionId), 'no worker found');

    const testPage = context.pages().find((candidate) => candidate.url().startsWith(ORIGIN));
    await testPage.bringToFront();
    await testPage.click('#start');
    await testPage.waitForFunction(
      () => document.getElementById('label')?.textContent !== '—',
      undefined,
      { timeout: 15000 },
    );
    await testPage.waitForTimeout(1200);

    const hook = await testPage.evaluate(() => window.__LOOKGOOD__ ?? null);
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
    check('MAIN-world hook is installed', Boolean(hook));
    check('hook version matches package', hook?.version === pkg.version, hook?.version);

    const streamInfo = await testPage.evaluate(() => {
      const video = document.getElementById('video');
      const stream = video.srcObject;
      if (!stream) return { error: 'no srcObject' };
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 36;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
      }
      return {
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length,
        readyState: track?.readyState,
        label: track?.label,
        deviceId: settings.deviceId,
        width: settings.width,
        height: settings.height,
        frameRate: settings.frameRate,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        averageBrightness: sum / (pixels.length / 4) / 3,
      };
    });

    check('page received a video track', streamInfo.videoTracks === 1, JSON.stringify(streamInfo));
    check('video track is live', streamInfo.readyState === 'live');
    check('audio track passed through', streamInfo.audioTracks === 1);
    check(
      'frames are flowing',
      Number(streamInfo.averageBrightness) > 2,
      `brightness ${streamInfo.averageBrightness}`,
    );
    check('reported resolution is sane', Number(streamInfo.width) > 0 && Number(streamInfo.height) > 0);
    check('hook reports pipeline state', hook?.hasPipeline === true, String(hook?.hasPipeline));
    check('raw device label is preserved', Boolean(streamInfo.label) && streamInfo.label !== 'canvas', String(streamInfo.label));
    check('device id is preserved', Boolean(streamInfo.deviceId), String(streamInfo.deviceId));
    check(
      'video element matches the reported size',
      streamInfo.videoWidth === streamInfo.width && streamInfo.videoHeight === streamInfo.height,
      `${streamInfo.videoWidth}x${streamInfo.videoHeight} vs ${streamInfo.width}x${streamInfo.height}`,
    );

    const worker = context.serviceWorkers()[0];
    if (worker) {
      await applySettings(worker, {}, testPage);
      const baseline = await sampleFrame(testPage);
      check('test pattern red patch is visible', baseline.red.r > 150 && baseline.red.g < 90, JSON.stringify(baseline.red));
      check('test pattern gray patch is visible', Math.abs(baseline.gray.luma - 0.5) < 0.08, String(baseline.gray.luma));
      check('test pattern stripes have contrast', baseline.texture.contrast > 0.04, String(baseline.texture.contrast));

      await applySettings(worker, { colorCorrection: 100 }, testPage);
      const saturated = await sampleFrame(testPage);
      check(
        'color correction increases saturation',
        saturated.red.g < baseline.red.g - 3 && saturated.red.r >= baseline.red.r - 2,
        `g ${baseline.red.g.toFixed(1)} -> ${saturated.red.g.toFixed(1)}`,
      );
      check(
        'color correction leaves neutrals neutral',
        Math.abs(saturated.gray.r - saturated.gray.g) < 6,
        `${saturated.gray.r.toFixed(1)} / ${saturated.gray.g.toFixed(1)}`,
      );

      await applySettings(worker, { lightCorrection: 100 }, testPage);
      const brighter = await sampleFrame(testPage);
      check(
        'light correction brightens midtones',
        brighter.gray.luma > baseline.gray.luma + 0.05,
        `${baseline.gray.luma.toFixed(3)} -> ${brighter.gray.luma.toFixed(3)}`,
      );

      await applySettings(worker, { sharpening: 100 }, testPage);
      const sharpened = await sampleFrame(testPage);
      check(
        'sharpening raises edge contrast',
        sharpened.texture.contrast > baseline.texture.contrast + 0.02,
        `${baseline.texture.contrast.toFixed(3)} -> ${sharpened.texture.contrast.toFixed(3)}`,
      );

      await applySettings(worker, {}, testPage);
      const restored = await sampleFrame(testPage);
      check(
        'turning effects off restores the frame',
        Math.abs(restored.gray.luma - baseline.gray.luma) < 0.04 &&
          Math.abs(restored.texture.contrast - baseline.texture.contrast) < 0.03,
        `luma ${restored.gray.luma.toFixed(3)} contrast ${restored.texture.contrast.toFixed(3)}`,
      );

      await applySettings(worker, { backgroundBlur: 100 }, testPage);
      await testPage.waitForFunction(
        () => window.__LOOKGOOD__?.status?.ai === 'ready',
        undefined,
        { timeout: 30000 },
      );
      await testPage.waitForTimeout(900);
      const aiStatus = await testPage.evaluate(
        () => window.__LOOKGOOD__?.status ?? null,
      );
      check(
        'MediaPipe models load and report ready',
        aiStatus?.ai === 'ready',
        JSON.stringify(aiStatus),
      );
      const blurred = await sampleFrame(testPage);
      check(
        'background blur softens the room',
        blurred.texture.contrast < baseline.texture.contrast - 0.015,
        `${baseline.texture.contrast.toFixed(3)} -> ${blurred.texture.contrast.toFixed(3)}`,
      );

      await applySettings(worker, { portraitLighting: 100 }, testPage);
      await testPage.waitForTimeout(700);
      const portrait = await sampleFrame(testPage);
      check(
        'portrait lighting changes the exposure',
        Math.abs(portrait.gray.luma - baseline.gray.luma) > 0.03,
        `${baseline.gray.luma.toFixed(3)} -> ${portrait.gray.luma.toFixed(3)}`,
      );

      await applySettings(worker, {}, testPage);
      await testPage.waitForTimeout(500);
      const afterAi = await sampleFrame(testPage);
      check(
        'AI effects can be switched off again',
        Math.abs(afterAi.texture.contrast - baseline.texture.contrast) < 0.03,
        `${baseline.texture.contrast.toFixed(3)} -> ${afterAi.texture.contrast.toFixed(3)}`,
      );

      await applySettings(worker, { watermark: true }, testPage);
      await testPage.waitForTimeout(600);
      const watermarked = await sampleFrame(testPage);
      check(
        'watermark is drawn into the captured frame',
        watermarked.corner.luma < baseline.corner.luma - 0.01,
        `${baseline.corner.luma.toFixed(3)} -> ${watermarked.corner.luma.toFixed(3)}`,
      );

      await applySettings(worker, { showStats: true }, testPage);
      await testPage.waitForTimeout(600);
      const withStats = await sampleFrame(testPage);
      check(
        'stats readout is drawn into the captured frame',
        withStats.stats.luma < baseline.stats.luma - 0.015,
        `${baseline.stats.luma.toFixed(3)} -> ${withStats.stats.luma.toFixed(3)}`,
      );

      await applySettings(worker, {}, testPage);
      await testPage.waitForTimeout(400);
    }

    await testPage.screenshot({ path: join(artifactsDir, 'test-page.png') });

    if (extensionId) {
      const popup = await context.newPage();
      const popupErrors = [];
      popup.on('pageerror', (error) => popupErrors.push(String(error)));
      popup.on('console', (message) => {
        if (message.type() === 'error') popupErrors.push(message.text());
      });
      await popup.setViewportSize({ width: 360, height: 560 });
      await popup.goto(`chrome-extension://${extensionId}/popup/index.html`, {
        waitUntil: 'domcontentloaded',
      });
      await popup.waitForSelector('text=LookGood', { timeout: 5000 });
      const sliderCount = await popup.locator('input[type="range"]').count();
      check('popup renders all effect sliders', sliderCount === 6, `found ${sliderCount}`);

      await popup.locator('#slider-color').fill('42');
      await popup.waitForTimeout(500);
      const stored = await popup.evaluate(async () => {
        const result = await chrome.storage.sync.get('lookgood:settings');
        return result['lookgood:settings'] ?? null;
      });
      check('popup persists settings to chrome.storage.sync', stored?.colorCorrection === 42, JSON.stringify(stored));

      await popup.getByRole('switch', { name: 'Watermark' }).click();
      await popup.getByRole('switch', { name: 'Show stats' }).click();
      await popup.waitForTimeout(500);
      const outputSettings = await popup.evaluate(async () => {
        const result = await chrome.storage.sync.get('lookgood:settings');
        return result['lookgood:settings'] ?? null;
      });
      check(
        'popup persists the watermark and stats toggles',
        outputSettings?.watermark === true && outputSettings?.showStats === true,
        JSON.stringify(outputSettings),
      );

      await popup.locator('#preview-toggle').click();
      await popup.waitForFunction(
        () => {
          const video = document.getElementById('preview-video');
          return Boolean(video && video.videoWidth > 0 && video.readyState >= 2);
        },
        undefined,
        { timeout: 20000 },
      );
      const previewState = await popup.locator('#preview-state').textContent();
      check(
        'popup preview receives camera frames',
        Boolean(previewState && previewState.includes('×')),
        previewState,
      );

      await popup.locator('#slider-background-blur').fill('100');
      await popup.waitForFunction(
        () => {
          const text = document.getElementById('preview-state')?.textContent ?? '';
          return text.includes('· AI');
        },
        undefined,
        { timeout: 30000 },
      );
      check('popup preview loads AI effects', true);

      await popup.screenshot({ path: join(artifactsDir, 'popup.png'), fullPage: true });

      await popup.locator('#preview-toggle').click();
      await popup.waitForFunction(
        () => document.getElementById('preview-video')?.srcObject === null,
        undefined,
        { timeout: 5000 },
      );
      check('preview releases the camera when stopped', true);
      check('popup has no runtime errors', popupErrors.length === 0, popupErrors.join(' | '));
    }

    check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  } finally {
    if (context) await context.close();
    if (profile) rmSync(profile, { recursive: true, force: true });
    server.kill();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`e2e failed: ${failures.length} check(s) — ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('e2e passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
