import { CatalogRepository } from '../../apps/api/src/db/catalog.js';
import { scriptData } from './content.js';
import type { orchestrationHarness } from './orchestration.js';
export async function renderingFixture(h: Awaited<ReturnType<typeof orchestrationHarness>>) {
  const catalog = new CatalogRepository(h.db); const script = await catalog.createScript(h.owner, h.project, { researchVersionId: null, data: scriptData(), targetDurationMs: 10000 }); await catalog.activateScript(h.owner, h.project, script.id, 1);
  const image = await catalog.createAsset(h.owner, h.project, { type: 'IMAGE', mime: 'image/png', bytes: 75, checksum: 'a'.repeat(64), durationMs: null, width: 2, height: 2, origin: 'MANUAL', license: { source: 'Fixture propio', rightsAcknowledged: true }, prompt: null });
  const voice = await catalog.createAsset(h.owner, h.project, { type: 'AUDIO', mime: 'audio/wav', bytes: 160044, checksum: 'b'.repeat(64), durationMs: 10000, width: null, height: null, origin: 'MANUAL', license: { source: 'Tono propio de fixture', rightsAcknowledged: true }, prompt: null });
  for (const a of [image, voice]) await h.db.prepare("UPDATE assets SET availability='LOCAL_ONLY' WHERE id=?").bind(a.id).run();
  const scene = await catalog.createScene(h.owner, h.project, { stableKey: 'scene-one', orderIndex: 0 });
  const version = await catalog.createSceneVersion(h.owner, h.project, scene.id, { scriptVersionId: script.id, parentVersionId: null, narration: 'Narración de fixture.', direction: {}, durationMs: 10000, generationScope: 'ALL', shots: [{ orderIndex: 0, durationMs: 5000, type: 'IMAGE', prompt: 'Imagen', camera: {}, transition: {}, assetId: image.id }, { orderIndex: 1, durationMs: 5000, type: 'IMAGE', prompt: 'Imagen', camera: {}, transition: { type: 'DISSOLVE' }, assetId: image.id }],
    assetLinks: [{ assetId: voice.id, role: 'VOICE', offsetMs: 0, trimStartMs: 0, trimEndMs: 10000 }], voiceSegments: [{ audioAssetId: voice.id, segmentIndex: 0, text: 'Narración de fixture.', startMs: 0, endMs: 10000, alignment: { method: 'MANUAL', version: 1 } }] }); await catalog.activateSceneVersion(h.owner, h.project, scene.id, version.id, 1);
  return { catalog, script: (await catalog.getScript(h.owner,h.project,script.id))!, scene, version: (await catalog.getSceneVersion(h.owner,h.project,version.id))!, image: (await catalog.getAsset(h.owner,h.project,image.id))!, voice: (await catalog.getAsset(h.owner,h.project,voice.id))! };
}
