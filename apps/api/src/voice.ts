import type { SceneVersionInput } from '@video-studio/contracts';
import { voiceImportResultSchema, sceneVersionInputSchema } from '@video-studio/contracts';
import { estimateVoiceTimings, retimeShots } from '@video-studio/domain';
import type { z } from 'zod';
import { CatalogRepository } from './db/catalog.js';
import { JobConflict, JobNotFound } from './db/jobs.js';
export async function voiceSceneInput(catalog: CatalogRepository, owner: string, project: string, base: SceneVersionInput, result: z.infer<typeof voiceImportResultSchema>) {
  const asset = await catalog.getAsset(owner, project, result.assetId); if (!asset) throw new JobNotFound();
  if (asset.type !== 'AUDIO' || asset.availability === 'MISSING' || !asset.durationMs || asset.durationMs > 21600000 || asset.license.rightsAcknowledged !== true || !asset.license.source) throw new JobConflict();
  const duration = asset.durationMs; const timings = result.segments ?? estimateVoiceTimings(base.narration, duration); const method = result.segments ? 'MANUAL' as const : 'ESTIMATED' as const;
  const shots = retimeShots(base.shots, duration); let incompatible = false; const rejected = new Set<string>();
  for (const s of shots) if (s.type === 'VIDEO' && s.assetId) { const video = await catalog.getAsset(owner, project, s.assetId); if (!video?.durationMs || video.durationMs < s.durationMs) { rejected.add(s.assetId); s.assetId = null; incompatible = true; } }
  const links: SceneVersionInput['assetLinks'] = [];
  for (const l of base.assetLinks) {
    if (l.role === 'VOICE' || l.offsetMs >= duration || (l.role === 'VISUAL' && rejected.has(l.assetId))) continue;
    const linked = await catalog.getAsset(owner, project, l.assetId); if (!linked) throw new JobNotFound();
    const end = Math.min(l.trimEndMs ?? Number.MAX_SAFE_INTEGER, linked.durationMs ?? Number.MAX_SAFE_INTEGER, l.trimStartMs + duration - l.offsetMs);
    if (end > l.trimStartMs) links.push({ ...l, trimEndMs: end });
  }
  const input = sceneVersionInputSchema.parse({ ...base, generationScope: 'VOICE', durationMs: duration, shots, assetLinks: [...links, { assetId: asset.id, role: 'VOICE', offsetMs: 0, trimStartMs: 0, trimEndMs: duration }],
    voiceSegments: timings.map((s) => ({ ...s, audioAssetId: asset.id, alignment: { method, version: 1 } })),
    direction: { ...base.direction, voiceTimingMethod: method, alignmentPending: false, visualTimingReviewRequired: incompatible, voiceTimingReviewRequired: true } });
  return input;
}
