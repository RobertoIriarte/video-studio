import { deflateSync } from 'node:zlib';
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, bytes: Buffer) { const content = Buffer.concat([Buffer.from(type), bytes]); const n = Buffer.alloc(4); n.writeUInt32BE(bytes.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(content)); return Buffer.concat([n, content, crc]); }
export function pngFixture() {
  const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.from([0, 120, 60, 200, 255, 120, 60, 200, 255, 0, 120, 60, 200, 255, 120, 60, 200, 255]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function wavFixture(durationMs = 1000) {
  const size = durationMs * 16; const bytes = Buffer.alloc(44 + size); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(size, 40);
  for (let i = 0; i < size / 2; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 8000) * 1000), 44 + i * 2); return bytes;
}
