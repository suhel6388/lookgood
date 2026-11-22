import { RUNTIME, isReportStatusMessage, type EngineStatus } from '../shared/messages';
import { DEFAULT_SETTINGS, STORAGE_KEY } from '../shared/settings';

/**
 * The service worker is intentionally stateless: MV3 puts it to sleep at will.
 * Everything durable lives in chrome.storage; this file only seeds defaults and
 * mirrors pipeline status onto the toolbar badge for the active tab.
 */

async function ensureDefaults(): Promise<void> {
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    if (!stored[STORAGE_KEY]) {
      await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_SETTINGS });
    }
  } catch {
    /* storage may be unavailable in managed profiles */
  }
}

function updateBadge(tabId: number, status: EngineStatus): void {
  let text = '';
  let color = '#1f9d55';
  let title = 'LookGood Live';

  if (status.state === 'active') {
    text = status.ai === 'ready' ? 'AI' : 'ON';
    title = `LookGood Live is enhancing this tab${
      status.deviceLabel ? ` (${status.deviceLabel})` : ''
    }`;
  } else if (status.state === 'bypassed') {
    text = 'OFF';
    color = '#8a8f98';
    title = 'LookGood Live is paused for this tab';
  } else if (status.state === 'error') {
    text = '!';
    color = '#e5484d';
    title = `LookGood Live hit a problem: ${status.error ?? 'unknown error'}`;
  }

  void chrome.action.setBadgeText({ tabId, text });
  void chrome.action.setBadgeBackgroundColor({ tabId, color });
  void chrome.action.setTitle({ tabId, title });
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureDefaults();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureDefaults();
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isReportStatusMessage(message)) return;
  const tabId = sender.tab?.id;
  if (typeof tabId === 'number') updateBadge(tabId, message.status);
});

// Keep the runtime message channel referenced so bundlers do not drop it.
void RUNTIME;
