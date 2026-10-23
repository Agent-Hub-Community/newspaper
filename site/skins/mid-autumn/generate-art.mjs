import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// Original low-resolution sprites; keep nearest-neighbor pixels at display size.
function sprite(file, width, height, draw) {
  const pixels = Buffer.alloc(width * height * 4);
  const rect = (x, y, w, h, color) => {
    const rgb = color.match(/\w\w/g).map(v => parseInt(v, 16));
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (i >= 0 && j >= 0 && i < width && j < height) pixels.set([...rgb, 255], (j * width + i) * 4);
    }
  };
  draw(rect);
  const crc = data => {
    let c = -1;
    for (const byte of data) {
      c ^= byte;
      for (let b = 0; b < 8; b++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ -1) >>> 0;
  };
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  writeFileSync(new URL(file, import.meta.url), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0)),
  ]));
}

sprite('moon.png', 32, 32, r => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 < 230) r(x, y, 1, 1, 'd5a952');
    if ((x - 14.5) ** 2 + (y - 14) ** 2 < 195) r(x, y, 1, 1, 'ffe6a0');
  }
  r(7, 7, 5, 3, 'edcb78'); r(5, 10, 5, 5, 'edcb78');
  r(9, 22, 5, 3, 'edcb78'); r(20, 18, 5, 4, 'edcb78');
  r(13, 4, 7, 2, 'fff3c6'); r(5, 17, 2, 3, 'fff3c6');
});

sprite('mooncake.png', 56, 44, r => {
  // Scalloped baked edge, layered side and embossed square seal.
  for (const [x, y, w, h] of [[10, 6, 34, 34], [5, 10, 44, 26], [2, 15, 50, 16], [15, 3, 24, 38]]) r(x, y, w, h, '713b24');
  for (const [x, y, w, h] of [[10, 5, 34, 30], [5, 9, 44, 22], [2, 14, 50, 12], [15, 2, 24, 34]]) r(x, y, w, h, 'c8792b');
  r(11, 10, 32, 20, 'eab24c'); r(16, 6, 22, 28, 'eab24c');
  r(14, 11, 26, 19, '8d4724'); r(16, 13, 22, 15, 'f1bd5b');
  r(18, 15, 18, 2, 'a95927'); r(18, 24, 18, 2, 'a95927');
  r(18, 17, 2, 7, 'a95927'); r(34, 17, 2, 7, 'a95927');
  r(23, 18, 8, 2, 'a95927'); r(26, 16, 2, 10, 'a95927');
  r(21, 21, 12, 2, 'a95927');
  for (const x of [9, 15, 22, 30, 38, 44]) r(x, 32, 2, 5, 'e8a349');
  for (const [x, y] of [[8, 13], [12, 7], [20, 4], [32, 4], [42, 9], [46, 17], [8, 24], [39, 28]]) r(x, y, 3, 3, 'ffcf70');
});
