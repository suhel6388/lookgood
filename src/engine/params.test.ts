import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';
import { texelSize, toEffectUniforms } from './params';

describe('toEffectUniforms', () => {
  it('maps 0-100 to 0-1', () => {
    const uniforms = toEffectUniforms(
      normalizeSettings({ colorCorrection: 50, lightCorrection: 25, sharpening: 100 }),
    );
    expect(uniforms.color).toBeCloseTo(0.5);
    expect(uniforms.light).toBeCloseTo(0.25);
    expect(uniforms.sharpen).toBeCloseTo(1);
  });

  it('zeroes every effect when the master switch is off', () => {
    const uniforms = toEffectUniforms(
      normalizeSettings({ masterEnabled: false, colorCorrection: 80, backgroundBlur: 90 }),
    );
    expect(uniforms).toEqual({ master: 0, color: 0, light: 0, sharpen: 0 });
  });

  it('keeps defaults inside 0..1', () => {
    const uniforms = toEffectUniforms(DEFAULT_SETTINGS);
    for (const value of Object.values(uniforms)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
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
