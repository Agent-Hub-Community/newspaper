import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// Original pixel fireworks on a transparent background.
const width = 64, height = 40;
const pixels = Buffer.alloc(width * height * 4);
function rect(x, y, w, h, color) {
  const rgb = color.match(/\w\w/g).map(value => parseInt(value, 16));
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    pixels.set([...rgb, 255], (j * width + i) * 4);
  }
}

function burst(cx, cy, radius, color) {
  for (let ray = 0; ray < 12; ray++) {
    const angle = ray * Math.PI / 6;
    for (let distance = 5; distance <= radius; distance += 3) {
      rect(Math.round(cx + Math.cos(angle) * distance),
        Math.round(cy + Math.sin(angle) * distance), 2, 2, color);
    }
  }
  rect(cx, cy - 2, 2, 6, 'fff0c5');
  rect(cx - 2, cy, 6, 2, 'fff0c5');
}
burst(20, 17, 14, 'e9bc63');
burst(48, 12, 9, 'ffd5ae');
for (const [x, y] of [[17, 33], [15, 37], [43, 26], [41, 31], [39, 36]]) {
  rect(x, y, 2, 2, 'e9bc63');
}
for (const [x, y] of [[4, 4], [36, 3], [58, 28], [29, 35]]) {
  rect(x, y, 2, 2, 'fff0c5');
}

function chunk(name, data) {
  const body = Buffer.concat([Buffer.from(name), data]);
  let crc = -1;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ -1) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(width);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 6;
const rows = [];
for (let y = 0; y < height; y++) {
  rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
}
writeFileSync(new URL('fireworks.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))),
  chunk('IEND', Buffer.alloc(0)),
]));
