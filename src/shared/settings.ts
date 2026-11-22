/**
 * Settings shared by the popup, the isolated-world bridge and the MAIN-world
 * video pipeline. Every value is a plain JSON scalar so it can live in
 * chrome.storage.sync and travel over window.postMessage unchanged.
 */

export const SETTINGS_VERSION = 1;
export const STORAGE_KEY = 'lookgood:settings';

export type PresetId = 'off' | 'natural' | 'studio' | 'soft';

export interface LookSettings {
  masterEnabled: boolean;
  /** 0-100 sliders. 0 always means "effect disabled". */
  skinSmoothing: number;
  colorCorrection: number;
  lightCorrection: number;
  sharpening: number;
  portraitLighting: number;
  backgroundBlur: number;
  /** Branding overlay, off by default. Everything is free and unlocked. */
  watermark: boolean;
  /** Capture rate handed to canvas.captureStream(). */
  targetFps: number;
  /** How often the MediaPipe models run, independent of the render rate. */
  aiFps: number;
  /** Draw a small FPS/resolution readout onto the frame (debugging aid). */
  showStats: boolean;
}

export const DEFAULT_SETTINGS: LookSettings = {
  masterEnabled: true,
  skinSmoothing: 30,
  colorCorrection: 15,
  lightCorrection: 20,
  sharpening: 10,
  portraitLighting: 0,
  backgroundBlur: 0,
  watermark: false,
  targetFps: 30,
  aiFps: 15,
  showStats: false,
};

export const PRESETS: Record<PresetId, Partial<LookSettings>> = {
  off: {
    skinSmoothing: 0,
    colorCorrection: 0,
    lightCorrection: 0,
    sharpening: 0,
    portraitLighting: 0,
    backgroundBlur: 0,
  },
  natural: {
    skinSmoothing: 30,
    colorCorrection: 15,
    lightCorrection: 20,
    sharpening: 10,
    portraitLighting: 10,
    backgroundBlur: 0,
  },
  studio: {
    skinSmoothing: 45,
    colorCorrection: 35,
    lightCorrection: 30,
    sharpening: 25,
    portraitLighting: 35,
    backgroundBlur: 45,
  },
  soft: {
    skinSmoothing: 70,
    colorCorrection: 10,
    lightCorrection: 25,
    sharpening: 0,
    portraitLighting: 20,
    backgroundBlur: 60,
  },
};

export const SLIDER_KEYS = [
  'skinSmoothing',
  'colorCorrection',
  'lightCorrection',
  'sharpening',
  'portraitLighting',
  'backgroundBlur',
] as const;

export type SliderKey = (typeof SLIDER_KEYS)[number];

export const AI_EFFECT_KEYS: readonly SliderKey[] = [
  'skinSmoothing',
  'portraitLighting',
  'backgroundBlur',
];

export function clampIntensity(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Accepts anything that came out of storage or postMessage and returns a
 * complete, in-range settings object. Unknown keys are dropped on purpose so a
 * stale page cannot inject extra fields.
 */
export function normalizeSettings(raw: unknown): LookSettings {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;

  const normalized: LookSettings = {
    masterEnabled: asBoolean(input.masterEnabled, DEFAULT_SETTINGS.masterEnabled),
    skinSmoothing: clampIntensity(
      input.skinSmoothing,
      DEFAULT_SETTINGS.skinSmoothing,
    ),
    colorCorrection: clampIntensity(
      input.colorCorrection,
      DEFAULT_SETTINGS.colorCorrection,
    ),
    lightCorrection: clampIntensity(
      input.lightCorrection,
      DEFAULT_SETTINGS.lightCorrection,
    ),
    sharpening: clampIntensity(input.sharpening, DEFAULT_SETTINGS.sharpening),
    portraitLighting: clampIntensity(
      input.portraitLighting,
      DEFAULT_SETTINGS.portraitLighting,
    ),
    backgroundBlur: clampIntensity(
      input.backgroundBlur,
      DEFAULT_SETTINGS.backgroundBlur,
    ),
    watermark: asBoolean(input.watermark, DEFAULT_SETTINGS.watermark),
    targetFps: clampIntensity(input.targetFps, DEFAULT_SETTINGS.targetFps),
    aiFps: clampIntensity(input.aiFps, DEFAULT_SETTINGS.aiFps),
    showStats: asBoolean(input.showStats, DEFAULT_SETTINGS.showStats),
  };

  // Guard the two timing values against values that would stall the pipeline.
  normalized.targetFps = Math.min(60, Math.max(5, normalized.targetFps));
  normalized.aiFps = Math.min(30, Math.max(1, normalized.aiFps));

  return normalized;
}

export function hasActiveEffect(settings: LookSettings): boolean {
  if (!settings.masterEnabled) return false;
  return (
    settings.watermark ||
    settings.showStats ||
    SLIDER_KEYS.some((key) => settings[key] > 0)
  );
}

export function needsAi(settings: LookSettings): boolean {
  if (!settings.masterEnabled) return false;
  return AI_EFFECT_KEYS.some((key) => settings[key] > 0);
}

export function needsSegmentation(settings: LookSettings): boolean {
  if (!settings.masterEnabled) return false;
  return settings.backgroundBlur > 0 || settings.portraitLighting > 0;
}

export function needsFaceLandmarks(settings: LookSettings): boolean {
  if (!settings.masterEnabled) return false;
  return settings.skinSmoothing > 0;
}

export function applyPreset(
  settings: LookSettings,
  preset: PresetId,
): LookSettings {
  return normalizeSettings({ ...settings, ...PRESETS[preset] });
}

/** Returns the preset that exactly matches the current sliders, if any. */
export function matchPreset(settings: LookSettings): PresetId | null {
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const preset = PRESETS[id];
    const matches = SLIDER_KEYS.every(
      (key) => preset[key] === undefined || preset[key] === settings[key],
    );
    if (matches) return id;
  }
  return null;
}
