export const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const EFFECTS_FRAGMENT = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uFrame;
uniform vec2 uTexel;
uniform float uMaster;
uniform float uColor;
uniform float uLight;
uniform float uSharpen;

vec3 sampleFrame(vec2 uv) {
  return texture(uFrame, uv).rgb;
}

void main() {
  vec3 color = sampleFrame(vUv);

  if (uMaster < 0.5) {
    outColor = vec4(color, 1.0);
    return;
  }

  // Light correction: exposure first, then a gamma lift for the shadows.
  color *= 1.0 + uLight * 0.45;
  color = pow(max(color, 0.0), vec3(1.0 - uLight * 0.22));
  // Soft highlight rolloff so bright windows do not clip to flat white.
  color = color / (1.0 + max(color - 0.82, 0.0) * 0.55);

  // Color correction: saturation around perceptual luma plus a touch of contrast.
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, 1.0 + uColor * 0.7);
  color = (color - 0.5) * (1.0 + uColor * 0.18) + 0.5;

  // Sharpen: four diagonal taps make a cheap unsharp mask.
  vec3 blur = (
    sampleFrame(vUv + vec2(uTexel.x, uTexel.y)) +
    sampleFrame(vUv + vec2(-uTexel.x, uTexel.y)) +
    sampleFrame(vUv + vec2(uTexel.x, -uTexel.y)) +
    sampleFrame(vUv + vec2(-uTexel.x, -uTexel.y))
  ) * 0.25;
  color += (color - blur) * uSharpen * 1.35;

  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
