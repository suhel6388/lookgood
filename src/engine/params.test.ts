import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';
import {
  BACKGROUND_BLUR_UV,
  SKIN_BLUR_UV,
  blurStep,
  texelSize,
  toEffectUniforms,
} from './params';

describe('toEffectUniforms', () => {
  it('maps 0-100 to 0-1', () => {
    const uniforms = toEffectUniforms(
      normalizeSettings({
        colorCorrection: 50,
        lightCorrection: 25,
        sharpening: 100,
        skinSmoothing: 75,
        portraitLighting: 40,
        backgroundBlur: 60,
      }),
    );
    expect(uniforms.color).toBeCloseTo(0.5);
    expect(uniforms.light).toBeCloseTo(0.25);
    expect(uniforms.sharpen).toBeCloseTo(1);
    expect(uniforms.skin).toBeCloseTo(0.75);
    expect(uniforms.portrait).toBeCloseTo(0.4);
    expect(uniforms.background).toBeCloseTo(0.6);
  });

  it('zeroes every effect when the master switch is off', () => {
    const uniforms = toEffectUniforms(
      normalizeSettings({
        masterEnabled: false,
        colorCorrection: 80,
        backgroundBlur: 90,
        skinSmoothing: 70,
        portraitLighting: 50,
      }),
    );
    expect(uniforms).toEqual({
      master: 0,
      color: 0,
      light: 0,
      sharpen: 0,
      skin: 0,
      portrait: 0,
      background: 0,
    });
  });

  it('keeps defaults inside 0..1', () => {
    const uniforms = toEffectUniforms(DEFAULT_SETTINGS);
    for (const value of Object.values(uniforms)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('blurStep', () => {
  it('is zero when the effect is off', () => {
    expect(blurStep(0, SKIN_BLUR_UV)).toBe(0);
    expect(blurStep(0, BACKGROUND_BLUR_UV)).toBe(0);
  });

  it('reaches a quarter of the maximum radius at full intensity', () => {
    expect(blurStep(1, SKIN_BLUR_UV)).toBeCloseTo(SKIN_BLUR_UV / 4);
    expect(blurStep(1, BACKGROUND_BLUR_UV)).toBeCloseTo(BACKGROUND_BLUR_UV / 4);
  });

  it('clamps out-of-range input', () => {
    expect(blurStep(-2, SKIN_BLUR_UV)).toBe(0);
    expect(blurStep(4, SKIN_BLUR_UV)).toBeCloseTo(SKIN_BLUR_UV / 4);
    expect(blurStep(0.5, 0)).toBe(0);
  });
});

describe('texelSize', () => {
  it('returns one pixel in uv units', () => {
    expect(texelSize(1280, 720)).toEqual([1 / 1280, 1 / 720]);
  });

  it('never divides by zero', () => {
    expect(texelSize(0, 0)).toEqual([1, 1]);
  });
});
