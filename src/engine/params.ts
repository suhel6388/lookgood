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
  /** Skin smoothing, gated by the face mask. */
  skin: number;
  /** Portrait lighting: brightens the person, dims the room. */
  portrait: number;
  /** Background blur outside the person mask. */
  background: number;
}

/** Largest blur radius in uv units at full intensity. */
export const SKIN_BLUR_UV = 0.012;
export const BACKGROUND_BLUR_UV = 0.05;

/** Nine taps span -4..4, so the per-tap step is a quarter of the radius. */
const TAPS_PER_SIDE = 4;

export function toEffectUniforms(settings: LookSettings): EffectUniforms {
  const master = settings.masterEnabled ? 1 : 0;
  const scale = (value: number) => (master * Math.min(100, Math.max(0, value))) / 100;
  return {
    master,
    color: scale(settings.colorCorrection),
    light: scale(settings.lightCorrection),
    sharpen: scale(settings.sharpening),
    skin: scale(settings.skinSmoothing),
    portrait: scale(settings.portraitLighting),
    background: scale(settings.backgroundBlur),
  };
}

/** Per-tap uv offset for the separable blur, resolution independent. */
export function blurStep(intensity: number, maxUv: number): number {
  const clamped = Math.min(1, Math.max(0, intensity));
  return (clamped * Math.max(0, maxUv)) / TAPS_PER_SIDE;
}

export function texelSize(width: number, height: number): [number, number] {
  return [1 / Math.max(1, width), 1 / Math.max(1, height)];
}
