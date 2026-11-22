import {
  CHANNEL,
  IDLE_STATUS,
  RUNTIME,
  isPageToBridgeMessage,
  isQueryStatusRequest,
  type ConfigPayload,
  type EngineStatus,
} from '../shared/messages';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';
import { loadSettings, subscribeToSettings } from '../shared/storage';

/**
 * Isolated-world content script. It is the only side that can talk to both
 * chrome.* APIs and the page, so it owns the handshake with the MAIN-world
 * script and forwards settings changes without a round-trip through the
 * service worker (which may be asleep).
 */

const assetBase = chrome.runtime.getURL('');
let settings = normalizeSettings(DEFAULT_SETTINGS);
let lastStatus: EngineStatus = { ...IDLE_STATUS };

function postConfig(): void {
  const payload: ConfigPayload = { assetBase, settings };
  window.postMessage(
    { channel: CHANNEL, dir: 'to-page', type: 'config', payload },
    '*',
  );
}

function reportStatus(status: EngineStatus): void {
  try {
    void chrome.runtime
      .sendMessage({ type: RUNTIME.reportStatus, status })
      .catch(() => {});
  } catch {
    /* no service worker awake yet; the popup polls instead */
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const message = event.data as unknown;
  if (!isPageToBridgeMessage(message)) return;

  if (message.type === 'hello') {
    postConfig();
    return;
  }

  lastStatus = message.payload;
  reportStatus(lastStatus);
});

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
    if (!isQueryStatusRequest(message)) return;
    sendResponse({ status: lastStatus, settings });
    return true;
  },
);

void loadSettings().then((loaded) => {
  settings = loaded;
  postConfig();
});

subscribeToSettings((updated) => {
  settings = updated;
  postConfig();
});

// Announce readiness in case the MAIN-world script is already listening.
postConfig();
