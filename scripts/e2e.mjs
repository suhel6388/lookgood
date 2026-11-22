/**
 * End-to-end smoke test: launches a Chromium browser with the unpacked
 * extension, a fake camera and the local test page, then checks that the page
 * receives a real (hooked) stream and that the popup renders and persists.
 *
 *   npm run e2e
 *
 * Env:
 *   BROWSER_PATH  override the Chromium executable
 *   HEADED=1      force a visible browser window
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(rootDir, 'dist');
const artifactsDir = resolve(rootDir, '.artifacts');
const PORT = 5174;
const ORIGIN = `http://localhost:${PORT}`;

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
    const workers = context.serviceWorkers();
    for (const worker of workers) {
      const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.url());
      if (match) return match[1];
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  return null;
}

async function main() {
  mkdirSync(artifactsDir, { recursive: true });
  const server = spawn(process.execPath, [resolve(rootDir, 'scripts/serve-test.mjs')], {
    stdio: 'ignore',
  });

  let context;
  let profile;
  try {
    await waitForServer();
    const headed = process.env.HEADED === '1';
    ({ context, profile } = await launch(headed ? false : true));

    const page = await context.newPage();
    const pageErrors = [];
    const collectError = (text) => {
      if (/favicon|404 \(Not Found\)/.test(text)) return;
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

    const streamInfo = await testPage.evaluate(async () => {
      const video = document.getElementById('video');
      const stream = video.srcObject;
      if (!stream) return { error: 'no srcObject' };
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings?.() ?? {};
      // Sample the actual frames the page is showing.
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
      check('popup has no runtime errors', popupErrors.length === 0, popupErrors.join(' | '));

      await popup.locator('#slider-color').fill('42');
      await popup.waitForTimeout(500);
      const stored = await popup.evaluate(async () => {
        const result = await chrome.storage.sync.get('lookgood:settings');
        return result['lookgood:settings'] ?? null;
      });
      check('popup persists settings to chrome.storage.sync', stored?.colorCorrection === 42, JSON.stringify(stored));

      await popup.screenshot({ path: join(artifactsDir, 'popup.png'), fullPage: true });
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
