import { z } from 'zod';
import { assetInputSchema, assetSchema, contentHashSchema } from './catalog.js';
import { paginationQuerySchema, paginatedResponseSchema, utcTimestampSchema, uuidSchema } from './common.js';

export const WEB_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const mediaMetadataSchema = z.strictObject({ mime: assetInputSchema.shape.mime, type: assetInputSchema.shape.type, bytes: z.int().positive(), checksum: contentHashSchema, width: z.int().positive().nullable(), height: z.int().positive().nullable(), durationMs: z.int().positive().nullable() });
export const importInputSchema = z.strictObject({ projectId: uuidSchema, mime: assetInputSchema.shape.mime, bytes: z.int().positive().max(WEB_IMPORT_MAX_BYTES), checksum: contentHashSchema,
  license: z.strictObject({ source: z.string().trim().min(1).max(2048), note: z.string().trim().max(4000), rightsAcknowledged: z.literal(true) }), prompt: z.string().max(16000).nullable().default(null) });
export const importDtoSchema = importInputSchema.extend({ id: uuidSchema, state: z.enum(['PENDING', 'UPLOADED', 'VERIFIED']), requiresInspection: z.boolean(), createdAt: utcTimestampSchema, error: z.enum(['INVALID_MEDIA']).nullable().default(null) });
export const importListSchema = paginatedResponseSchema(importDtoSchema);
export const assetListSchema = paginatedResponseSchema(assetSchema);
export const assetQuerySchema = paginationQuerySchema.extend({ projectId: uuidSchema.optional(), type: assetInputSchema.shape.type.optional(), q: z.string().trim().max(100).optional() });
export const assetAccessSchema = z.strictObject({ assetId: uuidSchema, url: z.string().startsWith('/api/v1/assets/').nullable(), expiresAt: utcTimestampSchema.nullable(), availability: assetSchema.shape.availability });
export type MediaMetadata = z.infer<typeof mediaMetadataSchema>;

export async function bytesHash(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Inspección acotada de cabeceras/contenedor. Audio/video comprimido requiere FFprobe local.
export function inspectMedia(bytes: Uint8Array, mime: z.infer<typeof assetInputSchema.shape.mime>): Omit<MediaMetadata, 'checksum'> | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const n = bytes.length;
  const ascii = (at: number, size: number) => String.fromCharCode(...bytes.subarray(at, at + size));
  const fail = () => { throw new Error('INVALID_MEDIA'); };
  const dimensions = (width: number, height: number) => { if (!Number.isSafeInteger(width * height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16777216) fail(); return { mime, type: 'IMAGE' as const, bytes: n, width, height, durationMs: null }; };
  if (n < 12) return fail();
  if (mime === 'image/png') {
    if (bytes[0] !== 137 || ascii(1, 7) !== 'PNG\r\n\x1a\n') return fail();
    let at = 8; let width = 0; let height = 0; let data = false; let ended = false;
    while (at + 12 <= n) {
      const length = view.getUint32(at); if (length > n - at - 12) return fail(); const kind = ascii(at + 4, 4);
      let crc = 0xffffffff; for (let i = at + 4; i < at + 8 + length; i++) { crc ^= bytes[i]!; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(at + 8 + length)) return fail();
      if (at === 8) { if (kind !== 'IHDR' || length !== 13) return fail(); width = view.getUint32(at + 8); height = view.getUint32(at + 12); }
      if (kind === 'IDAT' && length > 0) data = true;
      at += length + 12; if (kind === 'IEND') { if (length || at !== n) return fail(); ended = true; break; }
    }
    if (!ended || !data) return fail(); return dimensions(width, height);
  }
  if (mime === 'image/jpeg') {
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[n - 2] !== 255 || bytes[n - 1] !== 217) return fail();
    let at = 2;
    while (at + 4 <= n) { if (bytes[at] !== 255) return fail(); while (bytes[at] === 255) at++; const marker = bytes[at++]!; if (marker === 218 || marker === 217) break;
      const length = view.getUint16(at); if (length < 2 || at + length > n) return fail();
      if ([192, 193, 194].includes(marker)) { if (length < 8) return fail(); return dimensions(view.getUint16(at + 5), view.getUint16(at + 3)); } at += length;
    } return fail();
  }
  if (mime === 'image/webp') {
    if (n < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== n) return fail();
    if (ascii(12, 4) === 'VP8X') return dimensions(1 + bytes[24]! + bytes[25]! * 256 + bytes[26]! * 65536, 1 + bytes[27]! + bytes[28]! * 256 + bytes[29]! * 65536);
    if (ascii(12, 4) === 'VP8 ' && ascii(23, 3) === '\x9d\x01\x2a') return dimensions(view.getUint16(26, true) & 16383, view.getUint16(28, true) & 16383);
    if (ascii(12, 4) === 'VP8L' && bytes[20] === 47) { const bits = view.getUint32(21, true); return dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1); } return fail();
  }
  if (mime === 'audio/wav') {
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE' || view.getUint32(4, true) + 8 !== n) return fail();
    let at = 12; let rate = 0; let block = 0; let data = 0;
    while (at + 8 <= n) { const kind = ascii(at, 4); const length = view.getUint32(at + 4, true); if (length > n - at - 8) return fail();
      if (kind === 'fmt ') { if (length < 16) return fail(); const format = view.getUint16(at + 8, true); const channels = view.getUint16(at + 10, true); const sampleRate = view.getUint32(at + 12, true); rate = view.getUint32(at + 16, true); block = view.getUint16(at + 20, true); const bits = view.getUint16(at + 22, true);
        if (![1, 3].includes(format) || ![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 192000 || ![8, 16, 24, 32].includes(bits) || block !== channels * bits / 8 || rate !== sampleRate * block) return fail(); }
      if (kind === 'data') data += length; at += 8 + length + length % 2;
    }
    if (at !== n || !rate || !data || data % block || Math.round(data / rate * 1000) < 1) return fail();
    return { mime, type: 'AUDIO', bytes: n, width: null, height: null, durationMs: Math.round(data / rate * 1000) };
  }
  if (mime === 'video/mp4' && ascii(4, 4) === 'ftyp' && view.getUint32(0) >= 16 && view.getUint32(0) <= n) return null;
  if (mime === 'audio/ogg' && ascii(0, 4) === 'OggS') return null;
  if (mime === 'audio/mpeg' && (ascii(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1]! & 224) === 224))) return null;
  return fail();
}
