/**
 * Generate purpose-created pixel-art PNG sheets for the Sprite Field
 * reference game. Run: node scripts/generateSpriteFieldAssets.mjs
 *
 * Assets are original (no copyrighted art): a two-frame idle/run player
 * blob and a two-frame enemy blob, plus a 1x1 white pixel for tint tests.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'playground', 'assets');
mkdirSync(root, { recursive: true });

/** Minimal PNG encoder: RGBA, no interlace. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Draw a rounded blob with eyes onto a frame at (fx, fy). */
function drawBlob(canvas, size, fx, fy, color, eyeColor, blink) {
  const set = (x, y, r, g, b, a) => {
    const px = fx * size + x;
    const py = fy * size + y;
    if (px < 0 || py < 0 || px >= canvas.width / 4 || py >= canvas.height / 4) return;
    const idx = (py * canvas.width + px) * 4;
    canvas.data[idx] = r;
    canvas.data[idx + 1] = g;
    canvas.data[idx + 2] = b;
    canvas.data[idx + 3] = a;
  };
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);
  const r = Math.floor(size * 0.4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        set(x, y, color[0], color[1], color[2], 255);
      }
    }
  }
  // Eyes.
  const eyeOffset = blink ? 3 : 4;
  for (const ex of [-4, 4]) {
    for (let dy = -1; dy <= 1; dy += 1) {
      set(cx + ex, cy - eyeOffset + dy, eyeColor[0], eyeColor[1], eyeColor[2], 255);
    }
  }
  // Feet (a darker shade) so run frames read as movement.
  for (let dx = -6; dx <= 6; dx += 1) {
    for (let dy = 0; dy <= 2; dy += 1) {
      set(cx + dx, cy + Math.floor(size * 0.42) + dy, 0, 0, 0, 255);
    }
  }
}

function makeSheet(framesAcross, framesDown, frameSize, draw) {
  const width = framesAcross * frameSize;
  const height = framesDown * frameSize;
  const canvas = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  for (let fy = 0; fy < framesDown; fy += 1) {
    for (let fx = 0; fx < framesAcross; fx += 1) {
      draw(canvas, frameSize, fx, fy);
    }
  }
  return encodePng(width, height, Buffer.from(canvas.data));
}

// Player sheet: 64x64, four 32x32 frames (idle-0, idle-1, run-0, run-1).
const player = makeSheet(2, 2, 32, (canvas, size, fx, fy) => {
  const blink = fy === 0 ? fx === 1 : fx === 1;
  const color = fy === 0 ? [64, 164, 220] : [52, 140, 200];
  drawBlob(canvas, size, fx, fy, color, [240, 250, 255], blink);
});
writeFileSync(join(root, 'player.png'), player);

// Enemy sheet: 32x32, two 16x16 frames (enemy-0, enemy-1).
const enemy = makeSheet(2, 1, 16, (canvas, size, fx, _fy) => {
  const color = fx === 0 ? [222, 84, 84] : [190, 60, 60];
  drawBlob(canvas, size, fx, 0, color, [255, 235, 235], fx === 1);
});
writeFileSync(join(root, 'enemies.png'), enemy);

console.log('written:', join(root, 'player.png'), join(root, 'enemies.png'));
