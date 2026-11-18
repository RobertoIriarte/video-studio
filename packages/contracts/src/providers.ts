import { z } from 'zod';
import { currencySchema, revisionSchema, utcTimestampSchema, uuidSchema } from './common.js';

export const providerKindSchema = z.enum(['TEXT', 'IMAGE', 'VIDEO', 'VOICE', 'STOCK', 'GRAPHICS']);
export const capabilitySchema = z.enum(['STRUCTURED_TEXT', 'TEXT_IMAGE', 'IMAGE_VIDEO', 'TEXT_VIDEO', 'FIRST_LAST_FRAME', 'VOICE', 'STOCK', 'GRAPHICS']);
export const integrationModeSchema = z.enum(['MANUAL', 'MOCK', 'SUBSCRIPTION', 'PAID_API']);
export const providerCapabilitiesSchema = z.strictObject({ operations: z.array(capabilitySchema).min(1).max(8),
  aspectRatios: z.array(z.literal('16:9')).max(1), languages: z.array(z.string().min(1).max(35)).max(32),
  maxDurationMs: z.int().positive().nullable(), maxBytes: z.int().positive().nullable(), polling: z.boolean(), cancellation: z.boolean(), idempotency: z.boolean() });
export const providerLimitsSchema = z.strictObject({ concurrency: z.int().min(1).max(8), quotaUnits: z.int().nonnegative().nullable(),
  windowMs: z.int().min(1000).max(86400000), maxCostPerJobMicros: z.int().nonnegative().nullable() });
export const providerPricingSchema = z.strictObject({ currency: currencySchema, costPerUnitMicros: z.int().nonnegative().nullable() });
export const providerInputSchema = z.strictObject({ name: z.string().trim().min(1).max(80), kind: providerKindSchema,
  adapterKey: z.enum(['MANUAL_ASSIST', 'MOCK_FIXTURE']), integrationMode: integrationModeSchema, enabled: z.boolean(), priority: z.int().min(0).max(1000),
  capabilities: providerCapabilitiesSchema, limits: providerLimitsSchema, pricing: providerPricingSchema,
}).refine((p) => (p.adapterKey === 'MANUAL_ASSIST' && p.integrationMode === 'MANUAL') || (p.adapterKey === 'MOCK_FIXTURE' && p.integrationMode === 'MOCK'));
export const providerDtoSchema = providerInputSchema.extend({ id: uuidSchema, status: z.enum(['MANUAL_ONLY', 'AVAILABLE', 'NOT_CONFIGURED', 'UNAVAILABLE']), revision: revisionSchema, updatedAt: utcTimestampSchema });
export const integrationReviewSchema = z.strictObject({ key: z.enum(['CHATGPT_TEXT', 'CHATGPT_IMAGE', 'FLOW_VIDEO', 'IMPORTED_VOICE', 'LICENSED_STOCK']), name: z.string().max(100), kind: providerKindSchema,
  status: z.literal('MANUAL_ONLY'), automatic: z.literal(false), requiresUserAction: z.literal(true), costKnown: z.literal(false), reviewedOn: z.iso.date(),
  toolUrl: z.url().startsWith('https://').nullable(), importFormats: z.array(z.enum(['application/json', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/wav', 'audio/mpeg', 'audio/ogg'])).min(1).max(7),
  reason: z.string().max(1000), sources: z.array(z.url().startsWith('https://')).max(4) });
export const integrationReviewsSchema = z.strictObject({ items: z.array(integrationReviewSchema).max(8) });
export const providerPatchSchema = z.strictObject({ expectedRevision: revisionSchema, enabled: z.boolean().optional(), priority: z.int().min(0).max(1000).optional(), limits: providerLimitsSchema.optional() })
  .refine((v) => Object.keys(v).length > 1);
export const providerRequestSchema = z.strictObject({ capability: capabilitySchema, aspectRatio: z.literal('16:9').optional(), language: z.string().max(35).optional(), durationMs: z.int().positive().optional(), bytes: z.int().positive().optional() });
export const reservationInputSchema = z.strictObject({ jobId: uuidSchema, providerId: uuidSchema, eventKey: uuidSchema, amountMicros: z.int().nonnegative().nullable(), units: z.int().positive(), currency: currencySchema });
export const reservationDtoSchema = z.strictObject({ id: uuidSchema, projectId: uuidSchema, jobId: uuidSchema, providerId: uuidSchema, eventKey: uuidSchema,
  status: z.enum(['RESERVED', 'SETTLED', 'RELEASED', 'UNKNOWN']), amountMicros: z.int().nonnegative(), units: z.int().nonnegative(), currency: currencySchema });
export const usageDtoSchema = z.strictObject({ currency: currencySchema, budgetMaxMicros: z.int().nonnegative(), reservedMicros: z.int().nonnegative(),
  settledMicros: z.int().nonnegative(), unknownMicros: z.int().nonnegative(), remainingMicros: z.int().nonnegative() });
export type ProviderDto = z.infer<typeof providerDtoSchema>;
export type ProviderInput = z.infer<typeof providerInputSchema>;
export type ReservationInput = z.infer<typeof reservationInputSchema>;
