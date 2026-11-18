// Draws the Hub icon with plain Node (no dependencies) and writes PNG files into tools/app/assets/.
// Run once:  node tools/app/make-icons.mjs   (the PNG files are checked in; run again only to change the look)
// Look: a rounded square in the dashboard blue with a white letter H. tray-needs.png = same, with a small amber dot.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "assets");
const BLUE = [0x0b, 0x5f, 0x8a], WHITE = [255, 255, 255], AMBER = [0xf5, 0xa6, 0x23];

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const inRound = (x, y, r) => { // x,y in 0..1; rounded square covering the whole icon
  const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const inH = (x, y) => inRect(x, y, 0.28, 0.25, 0.42, 0.75) || inRect(x, y, 0.58, 0.25, 0.72, 0.75) || inRect(x, y, 0.28, 0.44, 0.72, 0.56);
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function render(size, withDot) {
  const SS = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
      let col = null;
      if (inRound(x, y, 0.22)) {
        col = inH(x, y) ? WHITE : BLUE;
        if (withDot) { if (inCircle(x, y, 0.76, 0.76, 0.2)) col = inCircle(x, y, 0.76, 0.76, 0.15) ? AMBER : WHITE; }
      }
      if (col) { r += col[0]; g += col[1]; b += col[2]; a++; }
    }
    const o = (py * size + px) * 4;
    if (a) { buf[o] = Math.round(r / a); buf[o + 1] = Math.round(g / a); buf[o + 2] = Math.round(b / a); buf[o + 3] = Math.round((a / (SS * SS)) * 255); }
  }
  return png(size, buf);
}

mkdirSync(OUT, { recursive: true });
for (const s of [16, 32, 48, 256]) writeFileSync(join(OUT, `icon-${s}.png`), render(s, false));
writeFileSync(join(OUT, "icon.png"), render(256, false));
writeFileSync(join(OUT, "tray-needs.png"), render(32, true));
console.log("icons written to " + OUT);
