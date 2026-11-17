// A PNG writer and reader small enough to read: 8 bits a channel, no interlacing. For previews, the app's icons
// and enlarging screenshots.
import { deflateSync, inflateSync } from "node:zlib";

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** Encodes `rgba` (width x height x 4 bytes) as a PNG file. */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Channels per pixel for the PNG colour types read here: grey, RGB, grey with alpha, RGBA. */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Decodes a PNG file of 8 bits a channel into { width, height, rgba }. */
export function decodePng(file) {
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const channels = CHANNELS[file[25]];
  if (file[24] !== 8 || !channels || file[28] !== 0) throw new Error("only 8-bit PNGs without interlacing are read");

  const data = [];
  for (let at = 8; at < file.length; at += 12 + file.readUInt32BE(at)) {
    if (file.toString("ascii", at + 4, at + 8) === "IDAT") data.push(file.subarray(at + 8, at + 8 + file.readUInt32BE(at)));
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      // Each byte is stored as its difference from a neighbour: the one to the left, the one above, or both.
      const left = i >= channels ? rows[y * stride + i - channels] : 0;
      const up = y ? rows[(y - 1) * stride + i] : 0;
      const corner = y && i >= channels ? rows[(y - 1) * stride + i - channels] : 0;
      let guess = 0;
      if (filter === 1) guess = left;
      else if (filter === 2) guess = up;
      else if (filter === 3) guess = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        guess = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      rows[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + guess) & 0xff;
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  const grey = channels < 3;
  for (let p = 0; p < width * height; p++) {
    const at = p * channels;
    const alpha = channels % 2 ? 255 : rows[at + channels - 1];
    rgba.set([rows[at], rows[at + (grey ? 0 : 1)], rows[at + (grey ? 0 : 2)], alpha], p * 4);
  }
  return { width, height, rgba };
}
