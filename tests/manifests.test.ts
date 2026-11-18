import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileManifest } from '@video-studio/domain';
import { contentMutationSchema, renderManifestSchema } from '@video-studio/contracts';
import { orchestrationHarness } from './support/orchestration.js';
import { renderingFixture } from './support/rendering.js';
import { ManifestRepository } from '../apps/api/src/db/manifests.js';
import { catalogHash } from '../apps/api/src/db/catalog.js';
let h: Awaited<ReturnType<typeof orchestrationHarness>>;
beforeEach(async () => { h = await orchestrationHarness(); }); afterEach(async () => { await h.dispose(); });
describe('F6-01 manifests y montaje', { timeout: 60000 }, () => {
  it('frames/hashes deterministas; rechaza recursos, suma, orden y audio fuera de tiempo', async () => {
    const s = await renderingFixture(h); const edit = { shots: [], audio: [], overlays: [] }; const build = () => compileManifest(h.project, s.script.id, s.script.contentHash, [s.version], [s.image,s.voice], edit);
    const first = build(); expect(first.durationInFrames).toBe(300); expect(await catalogHash(build())).toBe(await catalogHash(first));
    expect(() => compileManifest(h.project,s.script.id,s.script.contentHash,[s.version],[],edit)).toThrow(); expect(() => compileManifest(h.project,s.script.id,s.script.contentHash,[s.version],[s.image,s.voice],{ ...edit,sceneOrder: [] })).toThrow();
    expect(renderManifestSchema.safeParse({ ...first, durationInFrames: 299 }).success).toBe(false); const wrong = structuredClone(first); wrong.scenes[0]!.audio[0]!.durationInFrames = 400; expect(renderManifestSchema.safeParse(wrong).success).toBe(false);
  });
  it('candidatas, activación CAS, receipts concurrentes y fuentes obsoletas conservan snapshot', async () => {
    const s = await renderingFixture(h); const repo = new ManifestRepository(h.db,h.runtime); const input = { expectedRevision: (await h.jobs.project(h.owner,h.project)).revision }; const key = crypto.randomUUID();
    const results = await Promise.all([repo.save(h.owner,h.project,key,input), repo.save(h.owner,h.project,key,input)]); expect(results[0]).toEqual(results[1]); const id = contentMutationSchema.parse(results[0]).versionId;
    const saved = await repo.get(h.owner,h.project,id); expect(saved.status).toBe('CANDIDATE'); const activation = { expectedRevision: (await h.jobs.project(h.owner,h.project)).revision, acknowledgeImpact: true };
    await repo.activate(h.owner,h.project,id,crypto.randomUUID(),activation); expect((await repo.list(h.owner,h.project)).current).toBe(true); await expect(repo.get(h.other,h.foreign,id)).rejects.toThrow();
    await expect(h.db.prepare("UPDATE render_manifests SET manifest_json='{}' WHERE id=?").bind(id).run()).rejects.toThrow();
    // Content activation changes pointers, never the stored manifest.
    await h.db.prepare('UPDATE scenes SET active_version_id=NULL,revision=revision+1 WHERE id=?').bind(s.scene.id).run(); expect(await repo.current(h.project,id)).toBe(false); expect((await repo.get(h.owner,h.project,id)).manifest).toEqual(saved.manifest);
    await expect(repo.save(h.owner,h.project,crypto.randomUUID(),{ expectedRevision: (await h.jobs.project(h.owner,h.project)).revision })).rejects.toThrow();
  });
});
