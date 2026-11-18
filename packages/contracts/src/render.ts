import { z } from 'zod';
import { uuidSchema, revisionSchema, utcTimestampSchema } from './common.js';
import { assetSchema, contentHashSchema } from './catalog.js';
const frame = z.int().nonnegative().max(648000);
const frames = z.int().positive().max(648000);
export const renderProfileSchema = z.strictObject({ preset: z.literal('FHD_MP4'), width: z.literal(1920), height: z.literal(1080), fps: z.literal(30), codec: z.literal('h264'), audioCodec: z.literal('aac'), pixelFormat: z.literal('yuv420p') });
export const renderProfile = renderProfileSchema.parse({ preset: 'FHD_MP4', width: 1920, height: 1080, fps: 30, codec: 'h264', audioCodec: 'aac', pixelFormat: 'yuv420p' });
export const shotEditSchema = z.strictObject({ shotId: uuidSchema, fit: z.enum(['cover', 'contain']).default('cover'), motion: z.enum(['NONE', 'PUSH_IN', 'PULL_OUT']).default('NONE'), transition: z.enum(['CUT', 'DISSOLVE']).default('CUT'), sourceStartMs: z.int().nonnegative().max(21600000).default(0) });
export const audioEditSchema = z.strictObject({ linkId: uuidSchema, gainDb: z.number().min(-60).max(6), fadeInFrames: frame, fadeOutFrames: frame });
export const overlaySchema = z.strictObject({ text: z.string().trim().min(1).max(500), startFrame: frame, durationInFrames: frames, position: z.enum(['TOP', 'BOTTOM']), fontSize: z.int().min(24).max(100) });
export const montageInputSchema = z.strictObject({ expectedRevision: revisionSchema, baseManifestId: uuidSchema.nullable().default(null), sceneOrder: z.array(uuidSchema).max(100).optional(), shots: z.array(shotEditSchema).max(1600).default([]), audio: z.array(audioEditSchema).max(1600).default([]), overlays: z.array(overlaySchema).max(128).default([]) });
export const manifestShotSchema = shotEditSchema.extend({ assetId: uuidSchema, checksum: contentHashSchema, type: z.enum(['IMAGE', 'VIDEO', 'GRAPHIC']), startFrame: frame, durationInFrames: frames });
export const manifestAudioSchema = audioEditSchema.extend({ assetId: uuidSchema, checksum: contentHashSchema, role: z.enum(['VOICE', 'MUSIC', 'AMBIENCE', 'SFX']), startFrame: frame, durationInFrames: frames, trimStartMs: z.int().nonnegative() });
export const manifestSceneSchema = z.strictObject({ sceneId: uuidSchema, sceneVersionId: uuidSchema, contentHash: contentHashSchema, narration: z.string().max(64000), startFrame: frame, durationInFrames: frames,
  shots: z.array(manifestShotSchema).min(1).max(16), audio: z.array(manifestAudioSchema).max(16),
  voiceSegments: z.array(z.strictObject({ text: z.string().max(64000), startFrame: frame, endFrame: frames, method: z.enum(['MANUAL', 'ESTIMATED']) })).max(256),
  review: z.strictObject({ narration: z.boolean(), visual: z.boolean() }) });
export const renderManifestSchema = z.strictObject({ schemaVersion: z.literal(1), projectId: uuidSchema, scriptVersionId: uuidSchema, scriptHash: contentHashSchema, profile: renderProfileSchema,
  durationInFrames: frames, scenes: z.array(manifestSceneSchema).min(1).max(100), assets: z.array(assetSchema).min(1).max(512), overlays: z.array(overlaySchema).max(128) })
  .superRefine((m, c) => {
    const fail = (message: string) => c.addIssue({ code: 'custom', message });
    if (new Set(m.assets.map((a) => a.id)).size !== m.assets.length || new Set(m.scenes.map((s) => s.sceneId)).size !== m.scenes.length) fail('Identidad duplicada.');
    const assets = new Map(m.assets.map((a) => [a.id, a])); let end = 0;
    for (const s of m.scenes) {
      if (s.startFrame !== end) fail('Timeline de escenas incoherente.'); end += s.durationInFrames; let shotEnd = s.startFrame;
      for (const shot of s.shots) { const a = assets.get(shot.assetId); if (shot.startFrame !== shotEnd || !a || a.projectId !== m.projectId || a.checksum !== shot.checksum || a.availability === 'MISSING' || a.type !== (shot.type === 'VIDEO' ? 'VIDEO' : 'IMAGE')) fail('Recurso/timing de toma inválido.');
        if (a?.type === 'VIDEO' && (!a.durationMs || shot.sourceStartMs + shot.durationInFrames * 1000 / 30 > a.durationMs + 34)) fail('Video insuficiente para la toma.'); shotEnd += shot.durationInFrames; }
      if (shotEnd !== end) fail('Suma de tomas inválida.');
      for (const track of s.audio) { const a = assets.get(track.assetId); if (!a || a.type !== 'AUDIO' || a.projectId !== m.projectId || a.checksum !== track.checksum || a.availability === 'MISSING' || !a.durationMs || track.trimStartMs + track.durationInFrames * 1000 / 30 > a.durationMs + 34 || track.startFrame < s.startFrame || track.startFrame + track.durationInFrames > end || track.fadeInFrames + track.fadeOutFrames > track.durationInFrames) fail('Audio fuera de tiempo o de alcance.'); }
      for (const seg of s.voiceSegments) if (seg.endFrame <= seg.startFrame || seg.startFrame < s.startFrame || seg.endFrame > end) fail('Segmento fuera del timeline.');
    }
    if (end !== m.durationInFrames || m.overlays.some((o) => o.startFrame + o.durationInFrames > end)) fail('Duración total inválida.');
    if (new TextEncoder().encode(JSON.stringify(m)).length > 4 * 1024 * 1024) fail('Manifest demasiado grande.');
  });
export const manifestDtoSchema = z.strictObject({ id: uuidSchema, projectId: uuidSchema, versionNo: revisionSchema, status: z.enum(['CANDIDATE', 'APPROVED', 'SUPERSEDED']), contentHash: contentHashSchema, createdAt: utcTimestampSchema, manifest: renderManifestSchema });
export const manifestViewSchema = z.strictObject({ revision: revisionSchema, activeId: uuidSchema.nullable(), current: z.boolean(), items: z.array(manifestDtoSchema).max(25), nextCursor: z.string().nullable() });
export const manifestActivateSchema = z.strictObject({ expectedRevision: revisionSchema, acknowledgeImpact: z.literal(true) });
export type RenderManifest = z.infer<typeof renderManifestSchema>;
export type MontageInput = z.infer<typeof montageInputSchema>;
export const renderStartSchema = z.strictObject({ expectedRevision: revisionSchema, manifestHash: contentHashSchema, preset: z.literal('FHD_MP4').default('FHD_MP4') });
export const renderTechnicalSchema = z.strictObject({ videoCodec: z.literal('h264'), audioCodec: z.literal('aac'), pixelFormat: z.literal('yuv420p'), fps: z.literal(30), frames: frames, loudnessI: z.number().min(-100).max(10), truePeakDbtp: z.number().min(-100).max(10), engine: z.string().max(300), analysisVersion:z.literal(1).optional(),blackFrameMs:z.number().nonnegative().max(21600000).optional(),longestSilenceMs:z.number().nonnegative().max(21600000).optional() });
export const renderArtifactSchema = z.strictObject({ renderId: uuidSchema, outputAssetId: uuidSchema, metadata: z.strictObject({ type: z.literal('VIDEO'), mime: z.literal('video/mp4'), bytes: z.int().positive().max(2147483648), checksum: contentHashSchema, durationMs: z.int().positive(), width: z.literal(1920), height: z.literal(1080) }), technical: renderTechnicalSchema });
export const renderCompleteSchema = renderArtifactSchema.extend({ leaseToken: uuidSchema });
export const renderAnalysisSchema=z.strictObject({blackFrameMs:z.number().nonnegative().max(21600000),longestSilenceMs:z.number().nonnegative().max(21600000),blackStartMs:z.number().nonnegative().nullable(),silenceStartMs:z.number().nonnegative().nullable()});
export const renderQaFailureSchema=z.strictObject({renderId:uuidSchema,leaseToken:uuidSchema,reason:z.enum(['CONTENT_DEFECTS','AUDIO_MEASUREMENT_FAILED','OUTPUT_PROFILE']),analysis:renderAnalysisSchema});
export const renderAssignmentSchema = z.strictObject({ renderId: uuidSchema, outputAssetId: uuidSchema, manifestHash: contentHashSchema, manifest: renderManifestSchema });
export const renderRecordSchema = z.strictObject({ id: uuidSchema, projectId: uuidSchema, jobId: uuidSchema, manifestId: uuidSchema, manifestHash: contentHashSchema, versionNo: revisionSchema, status: z.enum(['QUEUED', 'SUCCEEDED']), outputAssetId: uuidSchema.nullable(), checksum: contentHashSchema.nullable(), durationMs: z.int().positive().nullable(), technical: renderTechnicalSchema.nullable(), createdAt: utcTimestampSchema });
export const renderListSchema = z.strictObject({ items: z.array(renderRecordSchema).max(25), nextCursor: z.string().nullable() });
