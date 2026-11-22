import type { LookSettings } from '../shared/settings';

/**
 * Converts the 0-100 UI values into the 0-1 uniforms the shader expects.
 * Keeping this pure makes the mapping testable and keeps the renderer dumb.
 */
export interface EffectUniforms {
  /** 0 disables every pass and just copies the frame. */
  master: number;
  color: number;
  light: number;
  sharpen: number;
}

export function toEffectUniforms(settings: LookSettings): EffectUniforms {
  const master = settings.masterEnabled ? 1 : 0;
  const scale = (value: number) => (master * Math.min(100, Math.max(0, value))) / 100;
  return {
    master,
    color: scale(settings.colorCorrection),
    light: scale(settings.lightCorrection),
    sharpen: scale(settings.sharpening),
  };
}

export function texelSize(width: number, height: number): [number, number] {
  return [1 / Math.max(1, width), 1 / Math.max(1, height)];
}
