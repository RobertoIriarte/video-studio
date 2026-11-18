import { z } from 'zod';
import { paginationQuerySchema, paginatedResponseSchema, revisionSchema, utcTimestampSchema, uuidSchema } from './common.js';
import { contentHashSchema } from './catalog.js';

export const jobStatusSchema = z.enum(['PENDING', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_MANUAL', 'WAITING_RESOURCE', 'RETRY_SCHEDULED', 'PAUSED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'STALE']);
export const jobKindSchema = z.enum(['VALIDATE_INPUT', 'RESEARCH', 'SCRIPT', 'DIRECTION', 'VOICE', 'ASSET', 'ALIGNMENT', 'EDIT', 'QA', 'RENDER', 'SEO']);
export const executionTargetSchema = z.enum(['CLOUD', 'LOCAL', 'MANUAL']);
export const jobErrorCodeSchema = z.enum(['AUTH_REQUIRED', 'RATE_LIMIT', 'QUOTA_EXHAUSTED', 'INVALID_INPUT', 'UNSUPPORTED_CAPABILITY', 'PROVIDER_UNAVAILABLE', 'CONTENT_BLOCKED', 'UNKNOWN_OUTCOME', 'LOCAL_UNAVAILABLE', 'BUDGET_EXCEEDED', 'TRANSIENT', 'ATTEMPTS_EXHAUSTED', 'DISK_FULL', 'LOCAL_FILE_MISSING', 'RENDER_FAILED']);
export const jobErrorSchema = z.strictObject({ code: jobErrorCodeSchema, message: z.string().min(1).max(300), retryable: z.boolean() });
export const jobProgressSchema = z.strictObject({ completed: z.int().nonnegative().optional(), total: z.int().positive().optional(), message: z.string().max(300) })
  .refine((p) => p.completed === undefined || p.total === undefined || p.completed <= p.total);
export const jobInputRefSchema = z.strictObject({ kind: z.enum(['RESEARCH', 'SCRIPT', 'SCENE_VERSION', 'ASSET']), id: uuidSchema, hash: contentHashSchema });
export const jobPayloadSchema = z.record(z.string(), z.json()).refine((v) => new TextEncoder().encode(JSON.stringify(v)).length <= 65536);
export const jobInputSchema = z.strictObject({
  kind: jobKindSchema, executionTarget: executionTargetSchema, sceneId: uuidSchema.nullable().default(null),
  payload: jobPayloadSchema.default({}), inputRefs: z.array(jobInputRefSchema).max(8).default([]),
  dependencies: z.array(uuidSchema).max(16).default([]).refine((ids) => new Set(ids).size === ids.length),
  maxAttempts: z.int().min(1).max(10).default(3),
});
export const jobDtoSchema = z.strictObject({
  id: uuidSchema, projectId: uuidSchema, sceneId: uuidSchema.nullable(), kind: jobKindSchema, status: jobStatusSchema,
  executionTarget: executionTargetSchema, revision: revisionSchema, attempt: z.int().nonnegative(), maxAttempts: z.int().min(1).max(10),
  nextRunAt: utcTimestampSchema.nullable(), progress: jobProgressSchema, error: jobErrorSchema.nullable(), providerId: uuidSchema.nullable().default(null),
  outputRef: jobInputRefSchema.nullable(), createdAt: utcTimestampSchema, updatedAt: utcTimestampSchema,
});
export const attemptDtoSchema = z.strictObject({ id: uuidSchema, jobId: uuidSchema, attemptNo: revisionSchema, requestId: uuidSchema,
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED']), startedAt: utcTimestampSchema,
  endedAt: utcTimestampSchema.nullable(), errorCode: jobErrorCodeSchema.nullable(), providerOperationId: z.string().max(200).nullable(), providerId: uuidSchema.nullable().default(null) });
export const checkpointStageSchema = z.enum(['SCRIPT', 'DIRECTION']);
export const checkpointDtoSchema = z.strictObject({ id: uuidSchema, projectId: uuidSchema, jobId: uuidSchema, stage: checkpointStageSchema,
  subjectVersionId: uuidSchema, status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED']), blocking: z.boolean(), revision: revisionSchema,
  reviewedAt: utcTimestampSchema.nullable() });
export const activityDtoSchema = z.strictObject({ id: uuidSchema, projectId: uuidSchema, jobId: uuidSchema.nullable(),
  action: z.enum(['JOB_CREATED', 'JOB_READY', 'JOB_CLAIMED', 'JOB_SUCCEEDED', 'JOB_FAILED', 'JOB_RETRY', 'JOB_UNKNOWN', 'PROJECT_PAUSED', 'PROJECT_RESUMED', 'CHECKPOINT_APPROVED', 'CHECKPOINT_CREATED', 'CONTENT_CREATED', 'CONTENT_ACTIVATED', 'REGEN_REQUESTED']), createdAt: utcTimestampSchema });
export const jobsQuerySchema = paginationQuerySchema.extend({ projectId: uuidSchema.optional(), status: jobStatusSchema.optional() });
export const jobsListSchema = paginatedResponseSchema(jobDtoSchema);
export const jobDetailSchema = jobDtoSchema.extend({ attempts: z.array(attemptDtoSchema).max(100), dependencies: z.array(uuidSchema).max(16) });
export type JobDto = z.infer<typeof jobDtoSchema>;
export type JobInput = z.infer<typeof jobInputSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobErrorCode = z.infer<typeof jobErrorCodeSchema>;
export type JobInputRef = z.infer<typeof jobInputRefSchema>;
