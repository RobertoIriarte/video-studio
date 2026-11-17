import { z } from 'zod';
import { durationMsSchema, revisionSchema, utcTimestampSchema, uuidSchema } from './common.js';

export const versionStatusSchema = z.enum(['DRAFT', 'CANDIDATE', 'APPROVED', 'SUPERSEDED', 'INVALIDATED']);
export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
// Estructuras de agentes concretas se añadirán en F4; catálogo valida JSON acotado.
export const catalogDataSchema = z.record(z.string(), z.json()).refine((data) => new TextEncoder().encode(JSON.stringify(data)).length <= 262144, 'Metadatos demasiado grandes.');
export const sourceInputSchema = z.strictObject({
  url: z.url().refine((v) => ['http:', 'https:'].includes(new URL(v).protocol)).max(2048).nullable(),
  title: z.string().trim().min(1).max(500), acquiredAt: utcTimestampSchema,
  notes: z.string().max(16000), provenance: z.enum(['MANUAL', 'PROVIDER']), accessStatus: z.enum(['UNKNOWN', 'ACCESSIBLE', 'UNAVAILABLE']),
});
export const researchInputSchema = z.strictObject({ data: catalogDataSchema, sources: z.array(sourceInputSchema).max(32) });
export const scriptInputSchema = z.strictObject({ researchVersionId: uuidSchema.nullable(), data: catalogDataSchema, targetDurationMs: durationMsSchema });
export const sceneInputSchema = z.strictObject({ stableKey: z.string().trim().min(1).max(128), orderIndex: z.int().nonnegative() });
export const shotInputSchema = z.strictObject({
  orderIndex: z.int().nonnegative(), durationMs: durationMsSchema, type: z.enum(['IMAGE', 'VIDEO', 'GRAPHIC']),
  prompt: z.string().max(16000), camera: catalogDataSchema, transition: catalogDataSchema, assetId: uuidSchema.nullable(),
});
export const assetLinkInputSchema = z.strictObject({ assetId: uuidSchema, role: z.enum(['VISUAL', 'VOICE', 'MUSIC', 'AMBIENCE', 'SFX']), offsetMs: z.int().nonnegative(), trimStartMs: z.int().nonnegative(), trimEndMs: z.int().positive().nullable() })
  .refine((value) => value.trimEndMs === null || value.trimEndMs > value.trimStartMs);
export const sceneVersionInputSchema = z.strictObject({
  scriptVersionId: uuidSchema, parentVersionId: uuidSchema.nullable(), narration: z.string().max(64000), direction: catalogDataSchema,
  durationMs: durationMsSchema, generationScope: z.enum(['ALL', 'VISUAL', 'NARRATION', 'VOICE', 'MUSIC', 'AMBIENCE', 'EDIT']),
  shots: z.array(shotInputSchema).max(16), assetLinks: z.array(assetLinkInputSchema).max(16),
}).superRefine((value, context) => {
  if (new Set(value.shots.map((s) => s.orderIndex)).size !== value.shots.length) context.addIssue({ code: 'custom', path: ['shots'], message: 'Orden duplicado.' });
  if (value.shots.length && value.shots.reduce((sum, s) => sum + s.durationMs, 0) !== value.durationMs) context.addIssue({ code: 'custom', path: ['shots'], message: 'Duración incoherente.' });
});
export const assetInputSchema = z.strictObject({
  type: z.enum(['IMAGE', 'VIDEO', 'AUDIO']), mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']),
  bytes: z.int().positive(), checksum: contentHashSchema, durationMs: durationMsSchema.nullable(), width: z.int().positive().nullable(), height: z.int().positive().nullable(),
  origin: z.enum(['MANUAL', 'PROVIDER']), license: catalogDataSchema, prompt: z.string().max(16000).nullable(),
}).refine((value) => value.mime.startsWith(`${value.type.toLowerCase()}/`), 'Tipo MIME incompatible.');

const versionBase = z.strictObject({ id: uuidSchema, projectId: uuidSchema, versionNo: revisionSchema, status: versionStatusSchema, contentHash: contentHashSchema, createdAt: utcTimestampSchema });
export const sourceDtoSchema = sourceInputSchema.extend({ id: uuidSchema });
export const researchVersionSchema = versionBase.extend({ data: catalogDataSchema, sources: z.array(sourceDtoSchema).max(100) });
export const scriptVersionSchema = versionBase.extend({ researchVersionId: uuidSchema.nullable(), data: catalogDataSchema, targetDurationMs: durationMsSchema });
export const sceneSchema = sceneInputSchema.extend({ id: uuidSchema, projectId: uuidSchema, activeVersionId: uuidSchema.nullable(), revision: revisionSchema });
export const sceneVersionSchema = versionBase.extend({ sceneId: uuidSchema, scriptVersionId: uuidSchema, parentVersionId: uuidSchema.nullable(), narration: z.string().max(64000), direction: catalogDataSchema, durationMs: durationMsSchema, generationScope: sceneVersionInputSchema.shape.generationScope, shots: z.array(shotInputSchema.extend({ id: uuidSchema })).max(100), assetLinks: z.array(z.object({ id: uuidSchema }).and(assetLinkInputSchema)).max(100) });
// No paths de disco ni claves R2 en DTOs de catálogo.
export const assetSchema = assetInputSchema.extend({ id: uuidSchema, projectId: uuidSchema, availability: z.enum(['MISSING', 'LOCAL_ONLY', 'REMOTE_AVAILABLE', 'BOTH']), createdAt: utcTimestampSchema });
export type ResearchInput = z.infer<typeof researchInputSchema>;
export type ScriptInput = z.infer<typeof scriptInputSchema>;
export type SceneVersionInput = z.infer<typeof sceneVersionInputSchema>;
export type AssetInput = z.infer<typeof assetInputSchema>;
