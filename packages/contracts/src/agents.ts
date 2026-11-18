import { z } from 'zod';
import { durationMsSchema, uuidSchema } from './common.js';
import { sourceInputSchema } from './catalog.js';

const text = z.string().trim().min(1).max(16000);
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const agentMetadataSchema = z.strictObject({ schemaVersion: z.literal(1), promptVersion: z.string().min(1).max(100), model: z.string().min(1).max(100), simulated: z.boolean(), language: z.string().min(1).max(35) });
export const researchOutputSchema = z.strictObject({
  metadata: agentMetadataSchema,
  sources: z.array(sourceInputSchema.extend({ key })).max(32),
  claims: z.array(z.strictObject({ id: key, statement: text, sourceIds: z.array(key).max(32), confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']) })).max(100),
  outlineSuggestions: z.array(text).max(32), uncertainties: z.array(text).max(100),
}).superRefine((value, ctx) => {
  const ids = new Set(value.sources.map((s) => s.key));
  if (ids.size !== value.sources.length || new Set(value.claims.map((c) => c.id)).size !== value.claims.length) ctx.addIssue({ code: 'custom', message: 'Identidades duplicadas.' });
  for (const c of value.claims) if (!c.sourceIds.length || c.sourceIds.some((id) => !ids.has(id))) ctx.addIssue({ code: 'custom', path: ['claims'], message: 'Afirmación sin fuente trazable.' });
});
export const scriptOutputSchema = z.strictObject({ metadata: agentMetadataSchema, title: z.string().trim().min(1).max(200), hook: text,
  sections: z.array(z.strictObject({ stableKey: key, title: z.string().min(1).max(200), narration: text, claimIds: z.array(key).max(100), targetDurationMs: durationMsSchema })).min(1).max(100),
  closing: text, approximateWords: z.int().nonnegative(), riskNotes: z.array(text).max(100),
}).refine((s) => new Set(s.sections.map((v) => v.stableKey)).size === s.sections.length, 'Secciones duplicadas.');
export type ResearchOutput = z.infer<typeof researchOutputSchema>;
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;
export const visualBibleSchema = z.strictObject({ presetVersion: z.literal(1), palette: z.array(text).min(1).max(8), characters: z.array(text).max(16), locations: z.array(text).max(16), continuity: text, referenceAssetIds: z.array(uuidSchema).max(16) });
export const shotPlanSchema = z.strictObject({ durationMs: durationMsSchema, assetType: z.enum(['IMAGE', 'VIDEO', 'GRAPHIC']), subject: text, composition: text, framing: text, cameraMotion: text, light: text, mood: text,
  visualPrompt: text, negativePrompt: z.string().max(4000), refs: z.array(uuidSchema).max(16), startFrame: uuidSchema.nullable(), endFrame: uuidSchema.nullable(), transition: z.enum(['CUT', 'DISSOLVE']), audioCue: z.string().max(2000), licenseRequirement: text });
export const directionOutputSchema = z.strictObject({ metadata: agentMetadataSchema, visualBible: visualBibleSchema, warnings: z.array(text).max(32),
  scenes: z.array(z.strictObject({ stableKey: key, narration: text, durationMs: durationMsSchema, shotPlans: z.array(shotPlanSchema).min(1).max(16), musicMood: text, sfx: z.array(text).max(16), continuityNotes: text })).min(1).max(100),
}).superRefine((d, ctx) => {
  if (new Set(d.scenes.map((s) => s.stableKey)).size !== d.scenes.length) ctx.addIssue({ code: 'custom', message: 'Escenas duplicadas.' });
  for (const s of d.scenes) if (s.shotPlans.reduce((n, shot) => n + shot.durationMs, 0) !== s.durationMs) ctx.addIssue({ code: 'custom', path: ['scenes'], message: 'Duración de tomas incoherente.' });
});
export type DirectionOutput = z.infer<typeof directionOutputSchema>;

// Un único reintento estructural; ninguna ejecución de texto externo ni reparación infinita.
export async function validateAgentOutput<T>(schema: z.ZodType<T>, generate: (repair: boolean) => Promise<unknown>): Promise<T> {
  for (const repair of [false, true]) {
    const raw = await generate(repair);
    if (new TextEncoder().encode(JSON.stringify(raw)).length > 262144) throw new Error('AGENT_OUTPUT_TOO_LARGE');
    const parsed = schema.safeParse(raw); if (parsed.success) return parsed.data;
    if (repair) throw new Error('INVALID_AGENT_OUTPUT');
  }
  throw new Error('INVALID_AGENT_OUTPUT');
}
export function validateScriptClaims(script: ScriptOutput, research: ResearchOutput | null) {
  const ids = new Set(research?.claims.map((c) => c.id) ?? []);
  if (script.sections.some((s) => s.claimIds.some((id) => !ids.has(id)))) throw new Error('UNKNOWN_CLAIM');
}
