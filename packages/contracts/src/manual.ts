import { voiceImportResultSchema } from './voice.js';
import { z } from 'zod';
import { revisionSchema, uuidSchema } from './common.js';
import { researchOutputSchema, scriptOutputSchema } from './agents.js';
import { sceneVersionInputSchema } from './catalog.js';
import { jobDtoSchema, jobInputRefSchema } from './jobs.js';

export const manualResultSchema = z.discriminatedUnion('kind', [
  voiceImportResultSchema,
  z.strictObject({ kind: z.literal('RESEARCH'), data: researchOutputSchema }),
  z.strictObject({ kind: z.literal('SCRIPT'), data: scriptOutputSchema }),
  z.strictObject({ kind: z.literal('DIRECTION'), data: sceneVersionInputSchema }),
  z.strictObject({ kind: z.literal('ASSET'), assets: z.array(z.strictObject({ shotOrder: z.int().nonnegative(), assetId: uuidSchema })).max(16).default([]), audio: z.strictObject({ role: z.enum(['MUSIC', 'AMBIENCE']), assetId: uuidSchema }).optional() }).refine((v) => v.audio ? !v.assets.length : v.assets.length > 0),
]);
export const manualSubmitSchema = z.strictObject({ expectedRevision: revisionSchema, result: manualResultSchema })
  .refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= 262144, 'Resultado demasiado grande.');
export const manualPacketSchema = z.strictObject({ job: jobDtoSchema, prompt: z.string().max(2200000), template: z.string().max(1048576),
  references: z.array(z.strictObject({ ref: jobInputRefSchema, text: z.string().max(1048576) })).max(8),
  instructions: z.array(z.string().max(1000)).max(12),
});
export type ManualResult = z.infer<typeof manualResultSchema>;
