import { create } from 'zustand';
import {
  IDLE_STATUS,
  RUNTIME,
  type EngineStatus,
  type QueryStatusResponse,
} from '../shared/messages';
import {
  DEFAULT_SETTINGS,
  applyPreset,
  normalizeSettings,
  type LookSettings,
  type PresetId,
  type SliderKey,
} from '../shared/settings';
import {
  loadSettings,
  saveSettings,
  subscribeToSettings,
} from '../shared/storage';

interface PopupState {
  settings: LookSettings;
  status: EngineStatus;
  supported: boolean;
  hydrated: boolean;
  previewEnabled: boolean;
  setSlider: (key: SliderKey, value: number) => void;
  setMaster: (enabled: boolean) => void;
  setWatermark: (enabled: boolean) => void;
  setShowStats: (enabled: boolean) => void;
  setPreset: (preset: PresetId) => void;
  reset: () => void;
  togglePreview: () => void;
  hydrate: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(settings: LookSettings): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveSettings(settings);
  }, 120);
}

export const usePopupStore = create<PopupState>((set, get) => {
  const commit = (next: LookSettings) => {
    set({ settings: next });
    scheduleSave(next);
  };

  return {
    settings: normalizeSettings(DEFAULT_SETTINGS),
    status: { ...IDLE_STATUS },
    supported: false,
    hydrated: false,
    previewEnabled: false,

    setSlider: (key, value) => {
      const { settings } = get();
      if (settings[key] === value) return;
      commit(normalizeSettings({ ...settings, [key]: value }));
    },

    setMaster: (enabled) => {
      commit(normalizeSettings({ ...get().settings, masterEnabled: enabled }));
    },

    setWatermark: (enabled) => {
      commit(normalizeSettings({ ...get().settings, watermark: enabled }));
    },

    setShowStats: (enabled) => {
      commit(normalizeSettings({ ...get().settings, showStats: enabled }));
    },

    setPreset: (preset) => {
      commit(applyPreset(get().settings, preset));
    },

    reset: () => {
      commit(normalizeSettings({ ...DEFAULT_SETTINGS, masterEnabled: true }));
    },

    togglePreview: () => {
      set((state) => ({ previewEnabled: !state.previewEnabled }));
    },

    hydrate: async () => {
      const settings = await loadSettings();
      set({ settings, hydrated: true });
      await get().refreshStatus();
    },

    refreshStatus: async () => {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
        set({ supported: false, status: { ...IDLE_STATUS } });
        return;
      }
      try {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const tabId = tabs[0]?.id;
        if (typeof tabId !== 'number') throw new Error('no active tab');
        const response = (await chrome.tabs.sendMessage(tabId, {
          type: RUNTIME.queryStatus,
        })) as QueryStatusResponse | undefined;
        if (!response?.status) throw new Error('no bridge');
        set({ supported: true, status: response.status });
      } catch {
        set({ supported: false, status: { ...IDLE_STATUS } });
      }
    },
  };
});

/** Reflect edits made in another popup window or synced device. */
subscribeToSettings((settings) => {
  usePopupStore.setState({ settings });
});
