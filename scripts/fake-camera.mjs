/**
 * Writes a deterministic Y4M clip used as a fake camera in the e2e test.
 *
 * Layout (640x480):
 *   top-left      flat red
 *   top-right     flat green
 *   bottom-left   flat blue
 *   bottom-right  neutral gray, with a 2px vertical stripe block on the right
 *
 * The flat patches make color/light changes measurable; the 2px stripes make
 * sharpening and blur measurable.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const WIDTH = 640;
const HEIGHT = 480;

function rgbAt(x, y) {
  const right = x >= WIDTH / 2;
  const bottom = y >= HEIGHT / 2;
  if (!bottom && !right) return [220, 30, 30];
  if (!bottom && right) return [30, 190, 60];
  if (bottom && !right) return [40, 70, 220];
  // Bottom-right: stripes occupy the right quarter of the quadrant.
  if (x >= WIDTH * 0.75) {
    const level = Math.floor(x / 2) % 2 === 0 ? 100 : 156;
    return [level, level, level];
  }
  return [128, 128, 128];
}

const toY = ([r, g, b]) =>
  Math.max(16, Math.min(235, Math.round(16 + 0.257 * r + 0.504 * g + 0.098 * b)));
const toU = ([r, g, b]) =>
  Math.max(16, Math.min(240, Math.round(128 - 0.148 * r - 0.291 * g + 0.439 * b)));
const toV = ([r, g, b]) =>
  Math.max(16, Math.min(240, Math.round(128 + 0.439 * r - 0.368 * g - 0.071 * b)));

export function writeFakeCamera(filePath) {
  const luma = Buffer.alloc(WIDTH * HEIGHT);
  const chromaU = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2));
  const chromaV = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2));

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      luma[y * WIDTH + x] = toY(rgbAt(x, y));
    }
  }

  for (let y = 0; y < HEIGHT; y += 2) {
    for (let x = 0; x < WIDTH; x += 2) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const [pr, pg, pb] = rgbAt(x + dx, y + dy);
          r += pr;
          g += pg;
          b += pb;
        }
      }
      const average = [r / 4, g / 4, b / 4];
      const index = (y / 2) * (WIDTH / 2) + x / 2;
      chromaU[index] = toU(average);
      chromaV[index] = toV(average);
    }
  }

  const header = Buffer.from(
    `YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\nFRAME\n`,
    'ascii',
  );
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.concat([header, luma, chromaU, chromaV]));
  return filePath;
}
