/**
 * Generates the extension icons procedurally so the repository stays free of
 * binary design files. Draws a rounded-square lens mark with 4x supersampling.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const outDir = resolve(rootDir, 'assets/icons');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const mix = (a, b, t) => a + (b - a) * t;

/** Signed distance to a rounded rectangle, in pixels. */
function roundedRectDistance(x, y, size, radius) {
  const half = size / 2;
  const dx = Math.abs(x - half) - (half - radius);
  const dy = Math.abs(y - half) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function shade(x, y, size) {
  const unit = size / 128;
  const d = roundedRectDistance(x, y, size, 26 * unit);
  const rectAlpha = clamp01(0.5 - d);

  // Base: deep ink with a warm diagonal sheen.
  const t = clamp01((x + y) / (size * 2));
  let r = mix(18, 30, t);
  let g = mix(22, 30, t);
  let b = mix(30, 38, t);

  // Lens: two rings and a glassy core.
  const cx = size * 0.5;
  const cy = size * 0.48;
  const dist = Math.hypot(x - cx, y - cy);
  const outer = 34 * unit;
  const ringWidth = 7.5 * unit;
  const ring = clamp01(ringWidth / 2 + 0.75 - Math.abs(dist - outer));
  const inner = clamp01(ringWidth / 2 + 0.75 - Math.abs(dist - outer * 0.62));

  const warm = mix(0.55, 1, clamp01((y - (cy - outer)) / (outer * 2)));
  const ringColor = [
    mix(255, 255, warm),
    mix(146, 190, warm),
    mix(84, 132, warm),
  ];
  const ringAlpha = Math.max(ring, inner * 0.85);
  r = mix(r, ringColor[0], ringAlpha);
  g = mix(g, ringColor[1], ringAlpha);
  b = mix(b, ringColor[2], ringAlpha);

  const glass = clamp01(1 - Math.abs(dist - outer * 0.31) / (outer * 0.31));
  r = mix(r, 255, glass * 0.55);
  g = mix(g, 205, glass * 0.55);
  b = mix(b, 168, glass * 0.55);

  // Specular highlight, top-left of the lens.
  const spec = clamp01(
    1 - Math.hypot(x - (cx - outer * 0.3), y - (cy - outer * 0.34)) / (outer * 0.22),
  );
  r = mix(r, 255, spec * 0.75);
  g = mix(g, 246, spec * 0.75);
  b = mix(b, 235, spec * 0.75);

  return [r, g, b, rectAlpha];
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const [pr, pg, pb, pa] = shade(
            x + (sx + 0.5) / samples,
            y + (sy + 0.5) / samples,
            size,
          );
          r += pr * pa;
          g += pg * pa;
          b += pb * pa;
          a += pa;
        }
      }
      const count = samples * samples;
      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(a > 0 ? r / a : 0);
      rgba[offset + 1] = Math.round(a > 0 ? g / a : 0);
      rgba[offset + 2] = Math.round(a > 0 ? b / a : 0);
      rgba[offset + 3] = Math.round((a / count) * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = resolve(outDir, `icon${size}.png`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, render(size));
  console.log(`icon: ${file}`);
}
