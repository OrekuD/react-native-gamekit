/**
 * Generate the Platformer Lab tilesheet: four 32x32 tiles in one 128x32
 * RGBA PNG (original pixel art, no copyrighted sources).
 *
 *   slot 0 "ground"  — earth body with grass cap
 *   slot 1 "brick"   — orange brick pattern
 *   slot 2 "oneway"  — thin wooden plank (top quarter)
 *   slot 3 "cloud"   — soft cloud on transparent background
 *
 * Run: node scripts/generatePlatformerTilesheet.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'playground', 'assets');

const SIZE = 32;
const COUNT = 4;
const width = SIZE * COUNT;
const height = SIZE;

const data = Buffer.alloc(width * height * 4, 0);
function set(slot, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const idx = ((y * width) + slot * SIZE + x) * 4;
  data[idx] = r;
  data[idx + 1] = g;
  data[idx + 2] = b;
  data[idx + 3] = a;
}
function fillRect(slot, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) set(slot, x, y, ...c);
  }
}

// --- slot 0: ground ---------------------------------------------------------
fillRect(0, 0, 8, 32, 24, [122, 85, 58]); // earth
// dithered dirt speckles
for (let i = 0; i < 40; i++) {
  const x = (i * 7 + 3) % 32;
  const y = 10 + ((i * 13) % 21);
  set(0, x, y, 104, 71, 48);
}
fillRect(0, 0, 0, 32, 6, [94, 168, 74]); // grass cap
for (let x = 0; x < 32; x += 2) set(0, x, 6, 94, 168, 74); // grass fringe
fillRect(0, 0, 7, 32, 1, [70, 128, 56]); // grass shadow line

// --- slot 1: brick ----------------------------------------------------------
fillRect(1, 0, 0, 32, 32, [196, 106, 62]);
fillRect(1, 0, 0, 32, 1, [232, 150, 100]); // top highlight
for (let row = 0; row < 4; row++) {
  const y = row * 8;
  fillRect(1, 0, y + 7, 32, 1, [140, 72, 42]); // horizontal mortar
  const offset = row % 2 === 0 ? 0 : 16;
  fillRect(1, (offset + 15) % 32, y, 1, 7, [140, 72, 42]); // vertical mortar
  fillRect(1, (offset + 31) % 32, y, 1, 7, [140, 72, 42]);
}

// --- slot 2: one-way plank --------------------------------------------------
fillRect(2, 0, 0, 32, 8, [176, 128, 78]); // plank top
fillRect(2, 0, 0, 32, 1, [214, 164, 108]); // highlight
fillRect(2, 0, 8, 32, 2, [130, 92, 54]); // underside
for (let x = 3; x < 32; x += 8) set(2, x, 4, [150, 106, 62]); // nail/grain dots

// --- slot 3: cloud (transparent bg) -----------------------------------------
const cloudPuffs = [
  [6, 20, 9], [14, 14, 11], [23, 19, 9],
];
for (const [cx, cy, r] of cloudPuffs) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) set(3, cx + x, cy + y, 250, 250, 255, 235);
    }
  }
}
set(3, 12, 12, 255, 255, 255, 255);
set(3, 16, 10, 255, 255, 255, 255);

// --- PNG encode --------------------------------------------------------------
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
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])));
  return Buffer.concat([len, typeBuf, body, crcBuf]);
}
const raw = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y += 1) {
  raw[y * (width * 4 + 1)] = 0;
  data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(root, 'platformer-tiles.png');
writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${width}x${height})`);
