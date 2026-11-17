import { z } from 'zod';

export const uuidSchema = z.uuid();
export const utcTimestampSchema = z.iso.datetime();
export const durationMsSchema = z.int().positive();
export const revisionSchema = z.int().positive();
export const instructionSchema = z.string().trim().max(4000);

const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));
export const currencySchema = z.string().trim().regex(/^[A-Z]{3}$/)
  .refine((code) => supportedCurrencies.has(code), 'Moneda no admitida por el runtime.');

const cursorSchema = z.string().trim().min(1).max(2048);
export const paginationQuerySchema = z.strictObject({
  cursor: cursorSchema.optional(),
  limit: z.preprocess((value) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
    z.int().min(1).max(100).default(25)),
});

export function paginatedResponseSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item).max(100), nextCursor: cursorSchema.nullable() });
}

export const validationIssueSchema = z.strictObject({
  path: z.array(z.string()),
  code: z.string(),
  message: z.literal('Valor no válido.'),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

// El borde API elegirá el HTTP status y requestId; nunca enviar ZodError en crudo.
export function safeValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.slice(0, 20).map((issue) => ({
    path: issue.path.map(String), code: issue.code, message: 'Valor no válido.',
  }));
}
