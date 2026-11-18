import { z } from 'zod';
import { revisionSchema, utcTimestampSchema, uuidSchema } from './common.js';
import { projectDtoSchema, projectStatusSchema } from './project.js';
import { activityDtoSchema, checkpointDtoSchema, jobDtoSchema, jobKindSchema, jobStatusSchema } from './jobs.js';
import { providerDtoSchema, providerKindSchema, usageDtoSchema } from './providers.js';

export const revisionInputSchema = z.strictObject({ expectedRevision: revisionSchema });
export const checkpointApproveSchema = revisionInputSchema.extend({ subjectVersionId: uuidSchema });
export const projectControlSchema = z.strictObject({ projectId: uuidSchema, revision: revisionSchema, status: projectStatusSchema, pauseRequested: z.boolean() });
export const startResponseSchema = z.strictObject({ projectId: uuidSchema, job: jobDtoSchema });
export const checkpointViewSchema = checkpointDtoSchema.extend({ versionNo: revisionSchema, current: z.boolean(), preview: z.record(z.string(), z.json()) });
export const productionSchema = z.strictObject({ project: projectDtoSchema, pauseRequested: z.boolean(), canStart: z.boolean(),
  counts: z.array(z.strictObject({ status: jobStatusSchema, count: z.int().nonnegative() })).max(12),
  progress: z.strictObject({ completedJobs: z.int().nonnegative(), registeredJobs: z.int().nonnegative(), plannedTotal: z.null() }),
  stages: z.array(z.strictObject({ kind: jobKindSchema, count: z.int().nonnegative(), completed: z.int().nonnegative() })).max(11),
  jobs: z.array(jobDtoSchema).max(25), checkpoints: z.array(checkpointViewSchema).max(100), activity: z.array(activityDtoSchema).max(25),
  usage: usageDtoSchema, agent: z.enum(['NOT_CONFIGURED', 'ONLINE', 'OFFLINE']), availabilityMessage: z.string().max(500), updatedAt: utcTimestampSchema });
export const providerListSchema = z.strictObject({ items: z.array(providerDtoSchema).max(100) });
export const manualProviderCreateSchema = z.strictObject({ name: z.string().trim().min(1).max(80), kind: providerKindSchema });
export const jobCursorSchema = z.strictObject({ createdAt: utcTimestampSchema, id: uuidSchema });
export type Production = z.infer<typeof productionSchema>;
