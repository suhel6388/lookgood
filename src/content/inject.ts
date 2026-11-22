import { VideoPipeline } from '../engine/pipeline';
import {
  CHANNEL,
  IDLE_STATUS,
  isBridgeToPageMessage,
  type EngineState,
  type EngineStatus,
} from '../shared/messages';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type LookSettings,
} from '../shared/settings';

/**
 * MAIN-world content script.
 *
 * Runs at document_start, before the page can call getUserMedia, and is the
 * only place where the page's own navigator.mediaDevices object can be
 * replaced. Non-video requests are forwarded untouched.
 */

declare global {
  interface Window {
    __LOOKGOOD__?: {
      version: string;
      assetBase: string;
      hasPipeline: boolean;
      status: EngineStatus;
    };
  }
}

const VERSION = '0.1.0';

let assetBase = '';
let settings: LookSettings = normalizeSettings(DEFAULT_SETTINGS);
let lastError: string | undefined;

const pipelines = new Set<VideoPipeline>();

function buildStatus(): EngineStatus {
  const list = Array.from(pipelines);
  const primary = list.find((pipeline) => pipeline.active) ?? list[0];

  let state: EngineState = 'idle';
  if (!settings.masterEnabled) state = 'bypassed';
  else if (primary?.error ?? lastError) state = 'error';
  else if (primary?.active) state = 'active';

  return {
    ...IDLE_STATUS,
    state,
    streams: list.length,
    ai: primary?.ai ?? 'off',
    fps: primary?.fps ?? 0,
    width: primary?.width ?? 0,
    height: primary?.height ?? 0,
    deviceLabel: primary?.deviceLabel ?? '',
    error: primary?.error ?? lastError,
  };
}

function publishStatus(): void {
  const status = buildStatus();
  if (window.__LOOKGOOD__) {
    window.__LOOKGOOD__.hasPipeline = pipelines.size > 0;
    window.__LOOKGOOD__.status = status;
  }
  window.postMessage(
    {
      channel: CHANNEL,
      dir: 'to-bridge',
      type: 'status',
      payload: status,
    },
    '*',
  );
}

function requestConfig(): void {
  window.postMessage({ channel: CHANNEL, dir: 'to-bridge', type: 'hello' }, '*');
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const message = event.data as unknown;
  if (!isBridgeToPageMessage(message)) return;

  assetBase = message.payload.assetBase;
  settings = normalizeSettings(message.payload.settings);
  if (window.__LOOKGOOD__) window.__LOOKGOOD__.assetBase = assetBase;
  for (const pipeline of pipelines) pipeline.updateSettings(settings);
  publishStatus();
});

window.__LOOKGOOD__ = {
  version: VERSION,
  assetBase,
  hasPipeline: false,
  status: { ...IDLE_STATUS },
};

const mediaDevices = navigator.mediaDevices;
const nativeGetUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);

function wantsVideo(constraints: MediaStreamConstraints | undefined): boolean {
  return Boolean(constraints?.video);
}

if (mediaDevices && nativeGetUserMedia) {
  mediaDevices.getUserMedia = async function getUserMedia(
    constraints?: MediaStreamConstraints,
  ): Promise<MediaStream> {
    if (!wantsVideo(constraints)) return nativeGetUserMedia(constraints);

    const raw = await nativeGetUserMedia(constraints);
    const pipeline = new VideoPipeline({
      stream: raw,
      settings,
      assetBase,
      onChange: publishStatus,
      onDispose: () => {
        pipelines.delete(pipeline);
        publishStatus();
      },
    });

    try {
      await pipeline.start();
    } catch (error) {
      // Fail open: a broken pipeline must never take the call down with it.
      pipeline.abort();
      lastError = error instanceof Error ? error.message : String(error);
      publishStatus();
      return raw;
    }

    lastError = undefined;
    pipelines.add(pipeline);
    publishStatus();
    return pipeline.outputStream;
  };
}

window.addEventListener('pagehide', () => {
  for (const pipeline of Array.from(pipelines)) pipeline.stop();
  pipelines.clear();
});

requestConfig();
publishStatus();
