import { z } from 'zod';
import { paginationQuerySchema, paginatedResponseSchema, revisionSchema, utcTimestampSchema, uuidSchema } from './common.js';
import { projectDtoSchema, projectInputSchema, projectStatusSchema } from './project.js';

export const wizardStepSchema = z.int().min(1).max(5);
export const projectCreateSchema = projectInputSchema.extend({ wizardStep: wizardStepSchema.default(1) });
export const projectPatchSchema = projectInputSchema.partial().extend({ expectedRevision: revisionSchema, wizardStep: wizardStepSchema.optional() })
  .refine((value) => Object.keys(value).length > 1);
export const projectArchiveSchema = z.strictObject({ expectedRevision: revisionSchema });
export const projectDetailSchema = projectDtoSchema.extend({ inputText: projectInputSchema.shape.inputText, wizardStep: wizardStepSchema });
export const projectListQuerySchema = paginationQuerySchema.extend({ q: z.string().trim().max(200).optional(), status: projectStatusSchema.optional() });
export const projectListSchema = paginatedResponseSchema(projectDtoSchema);
export const projectCursorSchema = z.strictObject({ updatedAt: utcTimestampSchema, id: uuidSchema });
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type ProjectPatch = z.infer<typeof projectPatchSchema>;
