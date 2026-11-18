import { z } from 'zod';
import { uuidSchema } from './common.js';
export const voiceTimingSchema = z.strictObject({ segmentIndex: z.int().nonnegative(), text: z.string().trim().min(1).max(64000), startMs: z.int().nonnegative(), endMs: z.int().positive() }).refine((s) => s.endMs > s.startMs);
export const voiceSegmentInputSchema = voiceTimingSchema.extend({ audioAssetId: uuidSchema, alignment: z.strictObject({ method: z.enum(['MANUAL', 'ESTIMATED']), version: z.literal(1) }) });
export const voiceSegmentsSchema = z.array(voiceSegmentInputSchema).max(256);
export const voiceImportResultSchema = z.strictObject({ kind: z.literal('VOICE'), assetId: uuidSchema, segments: z.array(voiceTimingSchema).min(1).max(256).optional() });
