import { z } from 'zod';
import { uuidSchema } from './common.js';

export const loginInputSchema = z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(1).max(128) });
export const bootstrapInputSchema = loginInputSchema.extend({ name: z.string().trim().min(1).max(200), password: z.string().min(12).max(128) });
export const authUserSchema = z.strictObject({ id: uuidSchema, name: z.string(), email: z.email() });
export const meResponseSchema = z.strictObject({ user: authUserSchema });
export type AuthUser = z.infer<typeof authUserSchema>;
