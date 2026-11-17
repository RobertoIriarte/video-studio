import { z } from 'zod';
import { currencySchema, durationMsSchema, revisionSchema, utcTimestampSchema, uuidSchema } from './common.js';

const titleSchema = z.string().trim().min(1).max(200);

export const inputTypeSchema = z.enum(['TOPIC', 'SCRIPT', 'SOURCES']);
export const projectStyleSchema = z.enum(['DOCUMENTARY', 'PREMIUM_REALISTIC', 'HORROR_MYSTERY']);
export const modalitySchema = z.enum(['DYNAMIC_IMAGES', 'HYBRID', 'CINEMATIC', 'EXPLAINER']);
export const productionModeSchema = z.enum(['AUTO', 'SUPERVISED']);
export const projectStatusSchema = z.enum([
  'DRAFT', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_RESOURCE', 'PAUSING', 'PAUSED',
  'FAILED', 'READY_RENDER', 'RENDERING', 'COMPLETED', 'ARCHIVED',
]);

export const projectSettingsSchema = z.strictObject({
  language: z.string().trim().min(1).max(35).refine((value) => {
    try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; }
  }, 'Idioma no válido.'),
  audience: z.string().trim().min(1).max(500),
  objective: z.literal('YOUTUBE_LONG'),
  targetDurationMs: durationMsSchema,
  style: projectStyleSchema,
  modality: modalitySchema,
  mode: productionModeSchema,
  budget: z.strictObject({ currency: currencySchema, maxMicros: z.int().nonnegative() }),
  providerPolicy: z.strictObject({
    allowPaidFallback: z.boolean(),
    preferredIds: z.array(uuidSchema).max(32).refine((ids) => new Set(ids).size === ids.length, 'Referencias duplicadas.'),
  }),
  checkpoints: z.array(z.string().trim().min(1).max(64)).max(16)
    .refine((stages) => new Set(stages).size === stages.length, 'Checkpoints duplicados.'),
});

export const DEFAULT_MAX_INPUT_BYTES = 1024 * 1024;

export function createProjectInputSchema({ maxInputBytes = DEFAULT_MAX_INPUT_BYTES }: { maxInputBytes?: number } = {}) {
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) {
    throw new RangeError('maxInputBytes debe ser un entero positivo seguro.');
  }
  const encoder = new TextEncoder();
  const inputText = z.string().superRefine((raw, context) => {
    // Limitar antes de trim; el padding y UTF-8 multibyte también consumen bytes.
    if (raw.length > maxInputBytes || encoder.encode(raw).byteLength > maxInputBytes) {
      context.addIssue({ code: 'custom', message: 'Texto de entrada demasiado grande.' });
    }
  }).trim().min(1);

  return z.strictObject({
    title: titleSchema,
    inputType: inputTypeSchema,
    inputText,
    settings: projectSettingsSchema,
  });
}

export const projectInputSchema = createProjectInputSchema();
export const projectDtoSchema = z.strictObject({
  id: uuidSchema,
  title: titleSchema,
  inputType: inputTypeSchema,
  status: projectStatusSchema,
  revision: revisionSchema,
  settings: projectSettingsSchema,
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
});

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type ProjectDto = z.infer<typeof projectDtoSchema>;
