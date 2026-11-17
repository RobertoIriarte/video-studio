import { z } from 'zod';

// Contratos de infraestructura F1-02; conservar compatibilidad de las respuestas.
export const apiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(['NOT_FOUND', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE', 'INVALID_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'CONFLICT', 'RATE_LIMITED']),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.uuid(),
    retryable: z.boolean(),
  }),
});

export const healthResponseSchema = z.strictObject({ status: z.literal('ok') });

export const versionResponseSchema = z.strictObject({
  apiVersion: z.literal('v1'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type VersionResponse = z.infer<typeof versionResponseSchema>;
