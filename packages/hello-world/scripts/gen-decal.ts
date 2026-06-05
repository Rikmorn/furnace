/**
 * One-off script: generates a 64x64 PNG with diagonal coloured stripes and
 * prints its data URL. Run: bun packages/hello-world/scripts/gen-decal.ts
 * Paste the output into packages/hello-world/src/demos/bowling/decal.ts.
 *
 * node:zlib is allowed here — this script is NOT imported by the app.
 */

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = new TextEncoder().encode(type);
  const body = new Uint8Array(t.length + data.length);
  body.set(t);
  body.set(data, t.length);
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(body, 4);
  dv.setUint32(4 + body.length, crc32(body));
  return out;
}

function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6; // 8-bit RGBA
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter byte
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const idat = new Uint8Array(deflateSync(raw));
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Build a 64x64 pattern: diagonal colour stripes (8px wide repeating bands).
// Colours: red / orange / yellow / green / cyan / blue / violet / white.
// Each pixel's stripe index = Math.floor((x + y) / 8) % 8
const STRIPE_COLORS: Array<readonly [number, number, number]> = [
  [220, 60, 60], // red
  [220, 140, 50], // orange
  [210, 200, 50], // yellow
  [60, 180, 80], // green
  [50, 190, 200], // cyan
  [60, 90, 210], // blue
  [160, 60, 210], // violet
  [230, 230, 230], // white
];

const W = 64;
const H = 64;
const rgba = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const stripe = Math.floor((x + y) / 8) % 8;
    // Boundary cast: stripe is always 0–7 (% 8) so the index is in-bounds.
    const [r, g, b] = STRIPE_COLORS[stripe] as readonly [
      number,
      number,
      number,
    ];
    const i = (y * W + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }
}

const png = encodePng(W, H, rgba);

// Write temp file for verification
writeFileSync("/tmp/decal.png", png);
console.error("Written to /tmp/decal.png — run: file /tmp/decal.png");

const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
console.log(dataUrl);
