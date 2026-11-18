import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentMutationSchema, renderTechnicalSchema } from '@video-studio/contracts';
import { editorialQa } from '@video-studio/domain';
import { ManifestRepository } from '../apps/api/src/db/manifests.js';
import { QaRepository } from '../apps/api/src/db/qa.js';
import { RenderRepository } from '../apps/api/src/db/renders.js';
import { AgentRepository } from '../apps/api/src/db/agents.js';
import { orchestrationHarness } from './support/orchestration.js';
import { renderingFixture } from './support/rendering.js';
let h:Awaited<ReturnType<typeof orchestrationHarness>>;
beforeEach(async()=>{h=await orchestrationHarness();});afterEach(async()=>{await h.dispose();});
async function setup(){const source=await renderingFixture(h);const manifests=new ManifestRepository(h.db,h.runtime);const saved=contentMutationSchema.parse(await manifests.save(h.owner,h.project,crypto.randomUUID(),{expectedRevision:(await h.jobs.project(h.owner,h.project)).revision}));await manifests.activate(h.owner,h.project,saved.versionId,crypto.randomUUID(),{expectedRevision:saved.revision,acknowledgeImpact:true});return{source,manifests,manifest:await manifests.get(h.owner,h.project,saved.versionId),qa:new QaRepository(h.db,h.runtime),renders:new RenderRepository(h.db,h.runtime)};}
async function revision(){return(await h.jobs.project(h.owner,h.project)).revision;}
describe('F6-03 QA por snapshot y correcciones acotadas',{timeout:60000},()=>{
  it('clasifica voz/segmentos/revisión/licencias y conserva compatibilidad del DTO técnico',async()=>{
    const {manifest}=await setup();const m=structuredClone(manifest.manifest);m.scenes[0]!.audio=[];m.scenes[0]!.review.visual=true;for(const a of m.assets)a.license={};
    expect(editorialQa(m).filter((f)=>f.severity==='BLOCKER').map((f)=>f.code)).toEqual(expect.arrayContaining(['NO_AUDIO','MISSING_VOICE','VISUAL_REVIEW','LICENSE_REQUIRED']));
    m.scenes[0]!.audio=manifest.manifest.scenes[0]!.audio;m.scenes[0]!.voiceSegments=[];expect(editorialQa(m).some((f)=>f.code==='MISSING_SEGMENTS')).toBe(true);
    expect(renderTechnicalSchema.safeParse({videoCodec:'h264',audioCodec:'aac',pixelFormat:'yuv420p',fps:30,frames:300,loudnessI:-14,truePeakDbtp:-1,engine:'Historical fixture'}).success).toBe(true);
  });
  it('no READY_RENDER sin aprobación explícita; CAS, aislamiento, replay e informes inmutables',async()=>{
    const {manifest,qa,renders,source}=await setup();const start=async()=>renders.start(h.owner,h.project,crypto.randomUUID(),{expectedRevision:await revision(),manifestHash:manifest.contentHash});await expect(start()).rejects.toThrow();
    const key=crypto.randomUUID();const input={expectedRevision:await revision(),manifestHash:manifest.contentHash};const report=await qa.run(h.owner,h.project,key,input);expect(await qa.run(h.owner,h.project,key,input)).toEqual(report);expect(report.status).toBe('PENDING');expect((await h.jobs.project(h.owner,h.project)).status).toBe('WAITING_APPROVAL');
    await expect(qa.get(h.other,h.project,report.id)).rejects.toThrow();await expect(qa.approve(h.owner,h.project,report.id,crypto.randomUUID(),{expectedRevision:2,manifestHash:manifest.contentHash,acknowledgeEditorialReview:true})).rejects.toThrow();
    const op=crypto.randomUUID();const approval={expectedRevision:1,manifestHash:manifest.contentHash,acknowledgeEditorialReview:true};expect((await qa.approve(h.owner,h.project,report.id,op,approval)).status).toBe('APPROVED');expect((await qa.approve(h.owner,h.project,report.id,op,approval)).status).toBe('APPROVED');expect((await h.jobs.project(h.owner,h.project)).status).toBe('READY_RENDER');
    await expect(h.db.prepare("UPDATE qa_reports SET findings_json='[]' WHERE id=?").bind(report.id).run()).rejects.toThrow();
    await h.db.prepare("UPDATE assets SET availability='MISSING' WHERE id=?").bind(source.image.id).run();await expect(start()).rejects.toThrow();await h.runner.reconcileProject(h.owner,h.project);expect((await h.jobs.project(h.owner,h.project)).status).not.toBe('READY_RENDER');await h.db.prepare("UPDATE assets SET availability='LOCAL_ONLY' WHERE id=?").bind(source.image.id).run();
    const newer=await qa.run(h.owner,h.project,crypto.randomUUID(),{expectedRevision:await revision(),manifestHash:manifest.contentHash});expect(newer.status).toBe('PENDING');await expect(renders.start(h.owner,h.project,crypto.randomUUID(),{expectedRevision:await revision(),manifestHash:manifest.contentHash})).rejects.toThrow();
    await h.db.prepare('UPDATE scenes SET active_version_id=NULL WHERE project_id=?').bind(h.project).run();await expect(qa.approve(h.owner,h.project,newer.id,crypto.randomUUID(),{expectedRevision:1,manifestHash:manifest.contentHash,acknowledgeEditorialReview:true})).rejects.toThrow();expect((await qa.get(h.owner,h.project,report.id)).status).toBe('APPROVED');
  });
  it('recurso ausente bloquea; dos correcciones, replay estable y ninguna activación implícita',async()=>{
    const {manifest,qa,source,renders}=await setup();await h.db.prepare("UPDATE assets SET availability='MISSING' WHERE id=?").bind(source.image.id).run();
    const report=await qa.run(h.owner,h.project,crypto.randomUUID(),{expectedRevision:await revision(),manifestHash:manifest.contentHash});expect(report.status).toBe('BLOCKED');await expect(qa.approve(h.owner,h.project,report.id,crypto.randomUUID(),{expectedRevision:1,manifestHash:manifest.contentHash,acknowledgeEditorialReview:true})).rejects.toThrow();await expect(renders.start(h.owner,h.project,crypto.randomUUID(),{expectedRevision:await revision(),manifestHash:manifest.contentHash})).rejects.toThrow();
    const finding=report.findings.find((f)=>f.code==='RESOURCE_MISSING')!;const operation=crypto.randomUUID();const input={expectedRevision:await revision(),findingId:finding.id};const first=await qa.repair(h.owner,h.project,report.id,operation,input);expect(first.round).toBe(1);
    const second=await qa.repair(h.owner,h.project,report.id,crypto.randomUUID(),{expectedRevision:await revision(),findingId:finding.id});expect(second.round).toBe(2);expect(await qa.repair(h.owner,h.project,report.id,operation,input)).toEqual(first);
    await expect(qa.repair(h.owner,h.project,report.id,crypto.randomUUID(),{expectedRevision:await revision(),findingId:finding.id})).rejects.toThrow();
    const rescan=await qa.run(h.owner,h.project,crypto.randomUUID(),{expectedRevision:await revision(),manifestHash:manifest.contentHash});await expect(qa.repair(h.owner,h.project,rescan.id,crypto.randomUUID(),{expectedRevision:await revision(),findingId:finding.id})).rejects.toThrow();
    const jobs=await h.db.prepare("SELECT scene_id,payload_json FROM jobs WHERE json_extract(payload_json,'$.qaReportId')=?").bind(report.id).all<{scene_id:string;payload_json:string}>();expect(jobs.results).toHaveLength(2);for(const j of jobs.results){expect(j.scene_id).toBe(source.scene.id);expect(JSON.parse(j.payload_json).scope).toBe('VISUAL');}
    expect((await source.catalog.getScene(h.owner,h.project,source.scene.id))!.activeVersionId).toBe(source.version.id);expect((await source.catalog.getSceneVersion(h.owner,h.project,source.version.id))!.narration).toBe(source.version.narration);
  });
  it('QA final fallido conserva informe y no publica asset; evidencia final aprobada es atómica',async()=>{
    const {manifest,qa,renders}=await setup();const report=await qa.run(h.owner,h.project,crypto.randomUUID(),{expectedRevision:await revision(),manifestHash:manifest.contentHash});await qa.approve(h.owner,h.project,report.id,crypto.randomUUID(),{expectedRevision:1,manifestHash:manifest.contentHash,acknowledgeEditorialReview:true});
    const agents=new AgentRepository(h.db,'fixture-secret',h.runtime);const pair=await agents.pairing(h.owner,crypto.randomUUID(),{label:'QA fixture'});const agent=await agents.pair(crypto.randomUUID(),{code:pair.code,name:'QA fixture',capabilities:{ffprobe:true,localImport:true,render:true,alignment:false}});
    const job=await renders.start(h.owner,h.project,crypto.randomUUID(),{expectedRevision:await revision(),manifestHash:manifest.contentHash});const lease=(await h.runner.claim(h.owner,h.project,agent.agentId,'LOCAL'))!;const task=await renders.assignment(h.owner,job.id);
    const failure={renderId:task.renderId,leaseToken:lease.leaseToken,reason:'CONTENT_DEFECTS',analysis:{blackFrameMs:500,longestSilenceMs:3000,blackStartMs:0,silenceStartMs:1000}};const operation=crypto.randomUUID();await agents.command(agent.agentId,operation,'RENDER_QA_FAIL',{id:job.id,input:failure});const failed=await renders.failQa(h.owner,job.id,failure,agent.agentId,operation);expect(failed.status).toBe('FAILED');expect((await agents.command(agent.agentId,operation,'RENDER_QA_FAIL',{id:job.id,input:failure})).response).toEqual(failed);const final=(await qa.list(h.owner,h.project)).items[0]!;expect(final.kind).toBe('FINAL');expect(final.status).toBe('BLOCKED');expect(final.findings.map((f)=>f.code)).toEqual(['BLACK_FRAMES','EXCESSIVE_SILENCE']);expect(await h.db.prepare('SELECT id FROM assets WHERE id=?').bind(task.outputAssetId).first()).toBeNull();expect((await h.jobs.project(h.owner,h.project)).status).toBe('FAILED');
    const repair=await qa.repair(h.owner,h.project,final.id,crypto.randomUUID(),{expectedRevision:await revision(),findingId:final.findings[0]!.id});expect(repair.round).toBe(1);
  });
});
