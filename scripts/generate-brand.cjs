// Reproducible code-drawn mark: a quiet screen with a play-shaped mountain.
// Built-in Node only; 4x supersampling keeps the small launcher mark crisp.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { Buffer } = require("node:buffer");
const root = path.dirname(require.resolve("../package.json"));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#0b1115"/><rect x="232" y="284" width="560" height="400" rx="56" fill="none" stroke="#8de5d2" stroke-width="28"/><path d="M432 396L616 496L432 596Z" fill="#8de5d2"/><path d="M436 744H588" stroke="#8de5d2" stroke-width="28" stroke-linecap="round"/></svg>\n`;
fs.writeFileSync(path.join(root, "assets/brand.svg"), svg);
function mark(horizontal, vertical) {
  const dx = Math.max(Math.abs(horizontal - 512) - 224, 0);
  const dy = Math.max(Math.abs(vertical - 484) - 144, 0);
  const distance = Math.hypot(dx, dy);
  const screen =
    Math.abs(distance - 56) <= 14 &&
    horizontal >= 218 &&
    horizontal <= 806 &&
    vertical >= 270 &&
    vertical <= 698;
  const play =
    horizontal >= 432 &&
    horizontal <= 616 &&
    Math.abs(vertical - 496) <= ((616 - horizontal) * 100) / 184;
  const foot =
    horizontal >= 436 && horizontal <= 588 && Math.abs(vertical - 744) <= 14;
  const ends =
    Math.hypot(horizontal - 436, vertical - 744) <= 14 ||
    Math.hypot(horizontal - 588, vertical - 744) <= 14;
  return screen || play || foot || ends;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([size, name, bytes, crc]);
}
function png(size, transparent) {
  const scan = Buffer.alloc((size * 4 + 1) * size);
  for (let vertical = 0; vertical < size; vertical++) {
    for (let horizontal = 0; horizontal < size; horizontal++) {
      let covered = 0;
      for (let subY = 0; subY < 4; subY++)
        for (let subX = 0; subX < 4; subX++) {
          if (
            mark(
              ((horizontal + (subX + 0.5) / 4) * 1024) / size,
              ((vertical + (subY + 0.5) / 4) * 1024) / size,
            )
          )
            covered++;
        }
      const fraction = covered / 16,
        offset = vertical * (size * 4 + 1) + horizontal * 4 + 1;
      const background = [11, 17, 21],
        foreground = [141, 229, 210];
      for (let color = 0; color < 3; color++)
        scan[offset + color] = transparent
          ? foreground[color]
          : Math.round(
              background[color] +
                fraction * (foreground[color] - background[color]),
            );
      scan[offset + 3] = transparent ? Math.round(255 * fraction) : 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(scan)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
fs.writeFileSync(path.join(root, "assets/icon.png"), png(1024, false));
fs.writeFileSync(path.join(root, "assets/adaptive-icon.png"), png(1024, true));
