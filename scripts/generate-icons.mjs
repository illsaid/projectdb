// Renders the Driftbox mark (lucide's audio-waveform on an amber tile) into the PWA icons in public/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const AMBER = [0xfb, 0xbf, 0x24];
const INK = [0x09, 0x0b, 0x0e];
const GLYPH_PATH = 'M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2';
const OUT = new URL('../public/', import.meta.url);

/** The glyph as a polyline in its 24-unit box: straight runs plus radius-2 arcs around the given centres. */
function glyphPoints() {
  const pts = [];
  const arc = (cx, cy, from, to) => {
    for (let i = 0; i <= 24; i++) {
      const a = ((from + ((to - from) * i) / 24) * Math.PI) / 180;
      pts.push([cx + 2 * Math.cos(a), cy + 2 * Math.sin(a)]);
    }
  };
  arc(2, 11, 90, 0);
  arc(6, 7, 180, 360);
  arc(10, 20, 180, 0);
  arc(14, 4, 180, 360);
  arc(18, 17, 180, 0);
  arc(22, 13, 180, 270);
  return pts;
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Signed distance outside a rounded square of half-size h and corner radius r, centred at c. */
function roundedBox(px, py, c, h, r) {
  const qx = Math.abs(px - c) - h + r;
  const qy = Math.abs(py - c) - h + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** RGBA pixels. `tile` is the amber square's share of the canvas (1 = full bleed, no rounding). */
function render(size, { tile, glyph }) {
  const pts = glyphPoints();
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const half = (size * tile) / 2;
  const radius = tile >= 1 ? 0 : half * (6 / 14);
  const unit = (size * glyph) / 24;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x + 0.5;
      const sy = y + 0.5;
      const inTile = tile >= 1 ? 1 : Math.max(0, Math.min(1, 0.5 - roundedBox(sx, sy, c, half, radius)));
      const gx = (sx - c) / unit + 12;
      const gy = (sy - c) / unit + 12;
      let d = Infinity;
      for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSegment(gx, gy, pts[i - 1], pts[i]));
      const stroke = Math.max(0, Math.min(1, (1 - d) * unit + 0.5));
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(AMBER[k] + (INK[k] - AMBER[k]) * stroke);
      px[i + 3] = Math.round(255 * inTile);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) raw.set(rgba.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="6" fill="${hex(AMBER)}"/><g transform="translate(6 6) scale(0.6667)" fill="none" stroke="${hex(INK)}" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="${GLYPH_PATH}"/></g></svg>\n`;

mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('icon.svg', OUT), svg);
const ANY = { tile: 0.875, glyph: 0.5 };
writeFileSync(new URL('pwa-192.png', OUT), png(192, render(192, ANY)));
writeFileSync(new URL('pwa-512.png', OUT), png(512, render(512, ANY)));
writeFileSync(new URL('maskable-512.png', OUT), png(512, render(512, { tile: 1, glyph: 0.46 })));
writeFileSync(new URL('apple-touch-icon.png', OUT), png(180, render(180, { tile: 1, glyph: 0.5 })));
console.log('icons written to public/');
