import { renderManifestSchema, renderProfile } from '@video-studio/contracts';
import type { RenderManifest, MontageInput } from '@video-studio/contracts';
import type { SceneVersion, AssetDto } from '@video-studio/contracts';
export const toFrames = (ms: number) => { if (!Number.isSafeInteger(ms) || ms < 0) throw new Error('INVALID_TIMING'); return Number((BigInt(ms) * 30n + 500n) / 1000n); };
export function compileManifest(projectId: string, scriptVersionId: string, scriptHash: string, versions: SceneVersion[], assets: AssetDto[], edits: Pick<MontageInput, 'sceneOrder' | 'shots' | 'audio' | 'overlays'>): RenderManifest {
  const order = edits.sceneOrder ?? versions.map((v) => v.sceneId);
  if (order.length !== versions.length || new Set(order).size !== order.length || order.some((id) => !versions.some((v) => v.sceneId === id))) throw new Error('INVALID_SCENE_ORDER');
  if (new Set(edits.shots.map((s) => s.shotId)).size !== edits.shots.length || new Set(edits.audio.map((a) => a.linkId)).size !== edits.audio.length) throw new Error('DUPLICATE_EDIT');
  const usedShots = new Set<string>(); const usedAudio = new Set<string>(); let ms = 0;
  const scenes = order.map((id) => {
    const v = versions.find((v) => v.sceneId === id)!; if (v.scriptVersionId !== scriptVersionId || v.status !== 'APPROVED') throw new Error('UNAPPROVED_SCENE');
    const startFrame = toFrames(ms); const sceneMs = ms; const end = toFrames(ms + v.durationMs);
    const shots = v.shots.map((s) => { if (!s.assetId) throw new Error('MISSING_ASSET'); const a = assets.find((a) => a.id === s.assetId); if (!a) throw new Error('MISSING_ASSET');
      const edit = edits.shots.find((e) => e.shotId === s.id); if (edit) usedShots.add(edit.shotId);
      const from = toFrames(ms); ms += s.durationMs;
      return { shotId: s.id, assetId: s.assetId, checksum: a.checksum, type: s.type, startFrame: from, durationInFrames: toFrames(ms) - from,
        fit: edit?.fit ?? 'cover' as const, motion: edit?.motion ?? (s.type === 'VIDEO' ? 'NONE' as const : 'PUSH_IN' as const), transition: edit?.transition ?? (s.transition.type === 'DISSOLVE' ? 'DISSOLVE' as const : 'CUT' as const), sourceStartMs: edit?.sourceStartMs ?? 0 }; });
    if (ms !== sceneMs + v.durationMs) throw new Error('INVALID_SHOT_SUM');
    const audio = v.assetLinks.filter((l) => l.role !== 'VISUAL').map((l) => { const a = assets.find((a) => a.id === l.assetId); if (!a?.durationMs) throw new Error('MISSING_AUDIO');
      const start = toFrames(sceneMs + l.offsetMs); const endFrame = Math.min(end, toFrames(sceneMs + l.offsetMs + (l.trimEndMs ?? a.durationMs) - l.trimStartMs)); const count = endFrame - start;
      const edit = edits.audio.find((e) => e.linkId === l.id); if (edit) usedAudio.add(edit.linkId);
      return { linkId: l.id, assetId: a.id, checksum: a.checksum, role: l.role as 'VOICE' | 'MUSIC' | 'AMBIENCE' | 'SFX', startFrame: start, durationInFrames: count, trimStartMs: l.trimStartMs,
        gainDb: edit?.gainDb ?? (l.role === 'VOICE' ? 0 : l.role === 'MUSIC' ? -22 : -24), fadeInFrames: edit?.fadeInFrames ?? Math.min(3, Math.floor(count / 2)), fadeOutFrames: edit?.fadeOutFrames ?? Math.min(3, Math.floor(count / 2)) }; });
    return { sceneId: id, sceneVersionId: v.id, contentHash: v.contentHash, narration: v.narration, startFrame, durationInFrames: end - startFrame, shots, audio,
      voiceSegments: v.voiceSegments.map((s) => ({ text: s.text, startFrame: toFrames(sceneMs + s.startMs), endFrame: toFrames(sceneMs + s.endMs), method: s.alignment.method })),
      review: { narration: v.direction.narrationReviewRequired === true, visual: v.direction.visualTimingReviewRequired === true } };
  });
  if (usedShots.size !== edits.shots.length || usedAudio.size !== edits.audio.length) throw new Error('UNKNOWN_EDIT');
  const used = new Set(scenes.flatMap((s) => [...s.shots.map((s) => s.assetId), ...s.audio.map((a) => a.assetId)]));
  return renderManifestSchema.parse({ schemaVersion: 1, projectId, scriptVersionId, scriptHash, profile: renderProfile, durationInFrames: toFrames(ms), scenes, assets: assets.filter((a) => used.has(a.id)).sort((a, b) => a.id.localeCompare(b.id)), overlays: edits.overlays });
}
