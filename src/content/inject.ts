import {
  CHANNEL,
  IDLE_STATUS,
  isBridgeToPageMessage,
  type EngineStatus,
} from '../shared/messages';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type LookSettings,
} from '../shared/settings';

/**
 * MAIN-world content script (phase 1: pass-through).
 *
 * It runs at document_start, before the page can call getUserMedia, and is the
 * only place where we can replace navigator.mediaDevices.getUserMedia for the
 * page itself. Anything that is not a video request is forwarded untouched.
 */

declare global {
  interface Window {
    __LOOKGOOD__?: {
      version: string;
      assetBase: string;
      hasPipeline: boolean;
    };
  }
}

const VERSION = '0.1.0';

let assetBase = '';
let settings: LookSettings = { ...DEFAULT_SETTINGS };
let activeStreams = 0;

function buildStatus(): EngineStatus {
  return {
    ...IDLE_STATUS,
    state: !settings.masterEnabled
      ? 'bypassed'
      : activeStreams > 0
        ? 'active'
        : 'idle',
    streams: activeStreams,
  };
}

function postStatus(): void {
  window.postMessage(
    {
      channel: CHANNEL,
      dir: 'to-bridge',
      type: 'status',
      payload: buildStatus(),
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
});

window.__LOOKGOOD__ = { version: VERSION, assetBase, hasPipeline: false };

const mediaDevices = navigator.mediaDevices;
const nativeGetUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);

function wantsVideo(constraints: MediaStreamConstraints | undefined): boolean {
  const video = constraints?.video;
  if (!video) return false;
  return true;
}

if (mediaDevices && nativeGetUserMedia) {
  mediaDevices.getUserMedia = async function getUserMedia(
    constraints?: MediaStreamConstraints,
  ): Promise<MediaStream> {
    if (!wantsVideo(constraints)) return nativeGetUserMedia(constraints);

    const stream = await nativeGetUserMedia(constraints);
    activeStreams += 1;
    postStatus();

    const cleanup = () => {
      activeStreams = Math.max(0, activeStreams - 1);
      postStatus();
    };
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', cleanup, { once: true });
    }

    // Phase 2 replaces this with a canvas pipeline. For now the page gets the
    // untouched camera stream and audio tracks stay exactly as requested.
    return stream;
  };
}

requestConfig();
postStatus();
