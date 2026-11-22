import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  normalizeSettings,
  type LookSettings,
} from './settings';

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.sync !== 'undefined'
  );
}

export async function loadSettings(): Promise<LookSettings> {
  if (!hasChromeStorage()) return { ...DEFAULT_SETTINGS };
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    return normalizeSettings(stored[STORAGE_KEY]);
  } catch {
    // Sync storage can be unavailable (quota, policy). Never break the call.
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: LookSettings): Promise<void> {
  if (!hasChromeStorage()) return;
  const normalized = normalizeSettings(settings);
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: normalized });
  } catch {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
    } catch {
      /* ignore */
    }
  }
}

/** Subscribe to settings written by another popup window / device. */
export function subscribeToSettings(
  callback: (settings: LookSettings) => void,
): () => void {
  if (!hasChromeStorage() || !chrome.storage.onChanged) return () => {};
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName !== 'sync' && areaName !== 'local') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    callback(normalizeSettings(change.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
