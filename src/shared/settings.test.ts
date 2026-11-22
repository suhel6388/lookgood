import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  PRESETS,
  SLIDER_KEYS,
  applyPreset,
  clampIntensity,
  hasActiveEffect,
  matchPreset,
  needsFaceLandmarks,
  needsSegmentation,
  normalizeSettings,
} from './settings';

describe('clampIntensity', () => {
  it('rounds and clamps into 0..100', () => {
    expect(clampIntensity(12.4)).toBe(12);
    expect(clampIntensity(12.6)).toBe(13);
    expect(clampIntensity(-5)).toBe(0);
    expect(clampIntensity(250)).toBe(100);
  });

  it('falls back for junk values', () => {
    expect(clampIntensity('nope', 42)).toBe(42);
    expect(clampIntensity(undefined, 7)).toBe(7);
    expect(clampIntensity(Number.NaN, 3)).toBe(3);
    expect(clampIntensity(Infinity, 3)).toBe(3);
  });
});

describe('normalizeSettings', () => {
  it('returns defaults for anything that is not an object', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('settings')).toEqual(DEFAULT_SETTINGS);
  });

  it('drops unknown keys and clamps every slider', () => {
    const result = normalizeSettings({
      skinSmoothing: 900,
      backgroundBlur: -10,
      evil: 'payload',
      masterEnabled: false,
    });
    expect(result.skinSmoothing).toBe(100);
    expect(result.backgroundBlur).toBe(0);
    expect(result.masterEnabled).toBe(false);
    expect('evil' in result).toBe(false);
  });

  it('keeps timing values inside safe bounds', () => {
    expect(normalizeSettings({ targetFps: 500 }).targetFps).toBe(60);
    expect(normalizeSettings({ targetFps: 0 }).targetFps).toBe(5);
    expect(normalizeSettings({ aiFps: 0 }).aiFps).toBe(1);
    expect(normalizeSettings({ aiFps: 99 }).aiFps).toBe(30);
  });

  it('is idempotent', () => {
    const once = normalizeSettings({ skinSmoothing: 33.6, watermark: true });
    expect(normalizeSettings(once)).toEqual(once);
  });
});

describe('effect detection', () => {
  it('reports no effects when the master switch is off', () => {
    const settings = { ...DEFAULT_SETTINGS, backgroundBlur: 80 };
    expect(hasActiveEffect({ ...settings, masterEnabled: false })).toBe(false);
    expect(needsSegmentation({ ...settings, masterEnabled: false })).toBe(false);
  });

  it('only asks for AI when an AI effect is on', () => {
    const shaderOnly = normalizeSettings({ backgroundBlur: 0, portraitLighting: 0, skinSmoothing: 0, sharpening: 50 });
    expect(needsSegmentation(shaderOnly)).toBe(false);
    expect(needsFaceLandmarks(shaderOnly)).toBe(false);
    expect(hasActiveEffect(shaderOnly)).toBe(true);

    const blurry = normalizeSettings({ backgroundBlur: 40, skinSmoothing: 0 });
    expect(needsSegmentation(blurry)).toBe(true);
    expect(needsFaceLandmarks(blurry)).toBe(false);
  });
});

describe('presets', () => {
  it('applies a preset without touching unrelated settings', () => {
    const base = normalizeSettings({ ...DEFAULT_SETTINGS, watermark: true });
    const studio = applyPreset(base, 'studio');
    expect(studio.watermark).toBe(true);
    for (const key of SLIDER_KEYS) {
      expect(studio[key]).toBe(PRESETS.studio[key] ?? DEFAULT_SETTINGS[key]);
    }
  });

  it('matches the preset it was built from', () => {
    expect(matchPreset(applyPreset(DEFAULT_SETTINGS, 'soft'))).toBe('soft');
    expect(matchPreset(applyPreset(DEFAULT_SETTINGS, 'off'))).toBe('off');
  });

  it('returns null for a custom mix', () => {
    const custom = normalizeSettings({ skinSmoothing: 12, backgroundBlur: 77 });
    expect(matchPreset(custom)).toBeNull();
  });
});
