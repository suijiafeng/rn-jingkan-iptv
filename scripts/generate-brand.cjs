// Reproducible code-drawn mark "静水播放": a rounded play triangle above three
// fading ripples on still water. Drawn on a 1024 grid, then scaled to 90%
// around the centre so it stays inside Android's adaptive-icon safe circle.
// Built-in Node only; 4x supersampling keeps the small launcher mark crisp.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { Buffer } = require("node:buffer");
const root = path.dirname(require.resolve("../package.json"));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#0b1115"/><g transform="translate(51.2 51.2) scale(0.9)" stroke="#8de5d2" stroke-linecap="round" stroke-linejoin="round"><path d="M432 260L672 400L432 540Z" fill="#8de5d2" stroke-width="40"/><path d="M312 650H712" stroke-width="26"/><path d="M372 710H652" stroke-width="26" opacity="0.6"/><path d="M432 770H592" stroke-width="26" opacity="0.3"/></g></svg>\n`;
fs.writeFileSync(path.join(root, "assets/brand.svg"), svg);
const MARK_SCALE = 0.9;
const TRIANGLE = [
  [432, 260],
  [672, 400],
  [432, 540],
];
const TRIANGLE_CORNER_RADIUS = 20;
const RIPPLE_HALF_WIDTH = 13;
const RIPPLES = [
  { start: 312, end: 712, level: 650, opacity: 1 },
  { start: 372, end: 652, level: 710, opacity: 0.6 },
  { start: 432, end: 592, level: 770, opacity: 0.3 },
];
function distanceToSegment(pointX, pointY, [startX, startY], [endX, endY]) {
  const spanX = endX - startX,
    spanY = endY - startY;
  const along = Math.min(
    Math.max(
      ((pointX - startX) * spanX + (pointY - startY) * spanY) /
        (spanX * spanX + spanY * spanY),
      0,
    ),
    1,
  );
  return Math.hypot(
    pointX - (startX + along * spanX),
    pointY - (startY + along * spanY),
  );
}
function insideTriangle(pointX, pointY) {
  const sides = TRIANGLE.map(([startX, startY], index) => {
    const [endX, endY] = TRIANGLE[(index + 1) % TRIANGLE.length];
    return (
      (endX - startX) * (pointY - startY) - (endY - startY) * (pointX - startX)
    );
  });
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}
// Returns the mark's opacity (0..1) at a point of the 1024 canvas.
function mark(horizontal, vertical) {
  const pointX = (horizontal - 512) / MARK_SCALE + 512;
  const pointY = (vertical - 512) / MARK_SCALE + 512;
  const nearEdge = TRIANGLE.some(
    (corner, index) =>
      distanceToSegment(
        pointX,
        pointY,
        corner,
        TRIANGLE[(index + 1) % TRIANGLE.length],
      ) <= TRIANGLE_CORNER_RADIUS,
  );
  if (nearEdge || insideTriangle(pointX, pointY)) return 1;
  let opacity = 0;
  for (const ripple of RIPPLES)
    if (
      distanceToSegment(
        pointX,
        pointY,
        [ripple.start, ripple.level],
        [ripple.end, ripple.level],
      ) <= RIPPLE_HALF_WIDTH
    )
      opacity = Math.max(opacity, ripple.opacity);
  return opacity;
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
          covered += mark(
            ((horizontal + (subX + 0.5) / 4) * 1024) / size,
            ((vertical + (subY + 0.5) / 4) * 1024) / size,
          );
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
