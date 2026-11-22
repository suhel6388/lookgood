export const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Separable nine-tap Gaussian, run once horizontally and once vertically. */
export const BLUR_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uStep;

void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -4; i <= 4; i++) {
    float offset = float(i);
    float weight = exp(-offset * offset / 8.0);
    sum += texture(uSource, vUv + uStep * offset) * weight;
    total += weight;
  }
  outColor = sum / total;
}`;

/** Four-tap box used to build the half and quarter resolution blur chains. */
export const DOWNSCALE_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uTexel;

void main() {
  vec4 sum = texture(uSource, vUv + vec2(-0.5, -0.5) * uTexel);
  sum += texture(uSource, vUv + vec2(0.5, -0.5) * uTexel);
  sum += texture(uSource, vUv + vec2(-0.5, 0.5) * uTexel);
  sum += texture(uSource, vUv + vec2(0.5, 0.5) * uTexel);
  outColor = sum * 0.25;
}`;

export const EFFECTS_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uFrame;
uniform sampler2D uSkinBlur;
uniform sampler2D uBackgroundBlur;
uniform sampler2D uPersonMask;
uniform sampler2D uFaceMask;

uniform vec2 uTexel;
uniform float uMaster;
uniform float uColor;
uniform float uLight;
uniform float uSharpen;
uniform float uSkin;
uniform float uPortrait;
uniform float uBackground;
uniform float uHasPerson;
uniform float uHasFace;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 sampleFrame(vec2 uv) {
  return texture(uFrame, uv).rgb;
}

void main() {
  vec3 color = sampleFrame(vUv);

  if (uMaster < 0.5) {
    outColor = vec4(color, 1.0);
    return;
  }

  // Sharpen first so the blur passes below cannot amplify edge noise.
  vec3 blur = (
    sampleFrame(vUv + vec2(uTexel.x, uTexel.y)) +
    sampleFrame(vUv + vec2(-uTexel.x, uTexel.y)) +
    sampleFrame(vUv + vec2(uTexel.x, -uTexel.y)) +
    sampleFrame(vUv + vec2(-uTexel.x, -uTexel.y))
  ) * 0.25;
  color += (color - blur) * uSharpen * 1.35;

  // Skin smoothing: blend toward the half-res blur inside the feathered face
  // oval, but leave high-detail areas (eyes, lips, hairline) untouched.
  if (uSkin > 0.001 && uHasFace > 0.5) {
    float face = texture(uFaceMask, vUv).r;
    if (face > 0.001) {
      vec3 soft = texture(uSkinBlur, vUv).rgb;
      float detail = abs(dot(color - soft, LUMA));
      float gate = 1.0 - smoothstep(0.035, 0.16, detail);
      color = mix(color, soft, uSkin * face * gate * 0.92);
    }
  }

  // Person mask: 1 is the subject, 0 is the room.
  float person = 0.0;
  if (uHasPerson > 0.5) {
    person = smoothstep(0.15, 0.85, texture(uPersonMask, vUv).r);
  }

  // Background blur keeps the subject sharp and softens everything else.
  if (uBackground > 0.001 && uHasPerson > 0.5) {
    vec3 room = texture(uBackgroundBlur, vUv).rgb;
    color = mix(room, color, person);
  }

  // Portrait lighting: lift the subject, gently fall off the room behind.
  if (uPortrait > 0.001) {
    color *= 1.0 + uPortrait * (0.32 * person - 0.42 * (1.0 - person));
  }

  // Light correction: exposure first, then a gamma lift for the shadows.
  color *= 1.0 + uLight * 0.45;
  color = pow(max(color, 0.0), vec3(1.0 - uLight * 0.22));
  // Soft highlight rolloff so bright windows do not clip to flat white.
  color = color / (1.0 + max(color - 0.82, 0.0) * 0.55);

  // Color correction: saturation around perceptual luma plus a touch of contrast.
  float luma = dot(color, LUMA);
  color = mix(vec3(luma), color, 1.0 + uColor * 0.7);
  color = (color - 0.5) * (1.0 + uColor * 0.18) + 0.5;

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
