import { expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { meResponseSchema, projectDetailSchema, pairingDtoSchema, agentClaimResponseSchema, jobDtoSchema, jobsListSchema, contentMutationSchema, qaReportSchema, youtubeViewSchema, youtubePackageSchema, youtubeExportSchema } from '@video-studio/contracts';
import { projectInputFixture } from '@video-studio/testkit';
import { MockVoiceAdapter } from '../../packages/providers/src/index.js';
import { authHarness } from './d1.js';
import { providerFixture } from './provider-fixtures.js';
import { pngFixture } from './media.js';
import { ProviderRepository } from '../../apps/api/src/db/providers.js';
import { CatalogRepository } from '../../apps/api/src/db/catalog.js';
import { JobRepository } from '../../apps/api/src/db/jobs.js';
import { ManualRepository } from '../../apps/api/src/manual.js';
import { advanceCoordinator } from '../../apps/api/src/coordinator.js';
import { prepareJob } from '../../apps/api/src/job-policy.js';
import { AgentClient } from '../../apps/local-agent/src/client.js';
import { readConfig } from '../../apps/local-agent/src/config.js';
import { importLocalFile } from '../../apps/local-agent/src/import.js';
import { executeRender } from '../../apps/local-agent/src/render-job.js';
import { defaultChrome, localRender } from '../../apps/local-agent/src/render.js';
import { defaultProbePath, probeFile } from '../../apps/local-agent/src/probe.js';
import { exportFromAgent } from '../../apps/local-agent/src/export.js';
import { fileHash } from '../../apps/local-agent/src/cache.js';
let chrome:string|undefined;let buildRoot:string|undefined;let composition:string|undefined;
const execute=promisify(execFile);
async function safeCleanup(root:string,prefix:string){const target=resolve(root);if(!target.startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith(prefix))throw new Error('UNSAFE_CLEANUP');await rm(target,{recursive:true,force:true});}
export async function prepareProductionScenario(){chrome=await defaultChrome();if(!chrome||!existsSync(defaultProbePath()))return false;buildRoot=await mkdtemp(join(tmpdir(),'video-studio-scenario-build-'));composition=join(buildRoot,'composition');await execute(process.execPath,['--input-type=module','-e',"import {buildComposition} from './infra/scripts/build-composition.mjs';await buildComposition(process.argv[1]);",composition],{windowsHide:true,shell:false,timeout:180000,maxBuffer:2097152});return true;}
export async function disposeProductionScenario(){if(buildRoot)await safeCleanup(buildRoot,'video-studio-scenario-build-');buildRoot=undefined;}
export async function runProductionScenario(options:{mode:'AUTO'|'SUPERVISED';inputType:'TOPIC'|'SCRIPT'|'SOURCES';recover?:boolean;persist?:boolean;afterComplete?:(context:{h:Awaited<ReturnType<typeof authHarness>>;root:string;mediaRoot:string;project:string;owner:string;password:string;cookie:string;exported:ReturnType<typeof youtubeExportSchema.parse>;composition:string;close:()=>Promise<void>})=>Promise<void>}){
  if(!chrome||!existsSync(defaultProbePath()))throw new Error('NATIVE_TOOLS_REQUIRED');
  let h:Awaited<ReturnType<typeof authHarness>>|undefined;let root:string|undefined;
  try{
  root=await mkdtemp(join(tmpdir(),'video-studio-auto-test-'));vi.stubEnv('VIDEO_STUDIO_AGENT_CONFIG',join(root,'agent.json'));h=await authHarness(options.persist?{persistRoot:join(root,'state')}:{});let cookie='';
  async function request(method:string,path:string,input?:unknown,key=crypto.randomUUID(),expected=200){const response=await h!.fetch(`/api/v1${path}`,{method,headers:{origin:h!.origin,cookie,'content-type':'application/json','idempotency-key':key},...(input===undefined?{}:{body:JSON.stringify(input)})});expect(response.status,`${method} ${path}`).toBe(expected);return response;}
  const password=`Fixture-${crypto.randomUUID()}`;
  const bootstrap=await h.fetch('/api/v1/bootstrap',{method:'POST',headers:{origin:h.origin,'content-type':'application/json',authorization:`Bearer ${h.bootstrapToken}`,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({name:'AUTO fixture',email:'auto@example.invalid',password})});expect(bootstrap.status).toBe(200);
  const login=await request('POST','/auth/sign-in/email',{email:'auto@example.invalid',password});cookie=login.headers.getSetCookie().map((v)=>v.split(';')[0]).join('; ');const owner=meResponseSchema.parse(await(await request('GET','/me')).json()).user.id;
  const input=projectInputFixture();input.title='Tema sintético AUTO';input.inputType=options.inputType;input.inputText=options.inputType==='SOURCES'?'Fuente propia https://example.invalid/fixture sin consulta de red.':'Guion o tema propio de prueba. Sin consultas externas.';input.settings.mode=options.mode;input.settings.targetDurationMs=5000;input.settings.budget.maxMicros=0;input.settings.providerPolicy.allowPaidFallback=false;input.settings.modality='DYNAMIC_IMAGES';
  const project=projectDetailSchema.parse(await(await request('POST','/projects',{...input,wizardStep:5},crypto.randomUUID(),201)).json());const id=project.id;const jobs=new JobRepository(h.db);const catalog=new CatalogRepository(h.db);
  await new ProviderRepository(h.db,true).create(owner,crypto.randomUUID(),providerFixture());
  const startKey=crypto.randomUUID();await request('POST',`/projects/${id}/start`,{expectedRevision:project.revision},startKey,202);await request('POST',`/projects/${id}/start`,{expectedRevision:project.revision},startKey,202);
  for(let tick=0;tick<12;tick++){await advanceCoordinator(h.db);if(options.mode==='SUPERVISED'){const pending=(await jobs.checkpoints(owner,id)).find((c)=>c.status==='PENDING');if(pending){expect((await jobs.get(owner,pending.jobId))!.status).toBe('WAITING_APPROVAL');await request('POST',`/checkpoints/${pending.id}/approve`,{expectedRevision:pending.revision,subjectVersionId:pending.subjectVersionId});}}const state=await h.db.prepare('SELECT active_version_id FROM scenes WHERE project_id=? AND active_version_id IS NOT NULL').bind(id).first<{active_version_id:string}>();if(state)break;}
  const scenes=(await h.db.prepare('SELECT id,active_version_id FROM scenes WHERE project_id=? ORDER BY order_index').bind(id).all<{id:string;active_version_id:string}>()).results;expect(scenes).toHaveLength(1);const scene=scenes[0]!;expect(scene.active_version_id).toBeTruthy();if(options.mode==='AUTO')expect(await jobs.checkpoints(owner,id)).toEqual([]);else expect((await jobs.checkpoints(owner,id)).filter((c)=>c.status==='APPROVED')).toHaveLength(2);
  const initial=(await jobs.list(owner,{projectId:id})).items;for(const kind of options.inputType==='SCRIPT'?['SCRIPT','DIRECTION']:['RESEARCH','SCRIPT','DIRECTION']){const matching=initial.filter((j)=>j.kind===kind);expect(matching).toHaveLength(1);expect(matching[0]!.status).toBe('SUCCEEDED');}
  const script=(await catalog.getScript(owner,id,(await jobs.project(owner,id)).active_script_version_id!))!;expect(script.data.metadata).toMatchObject({simulated:true});if(options.inputType==='SCRIPT')expect(script.researchVersionId).toBeNull();else expect(script.researchVersionId).toBeTruthy();

  const code=pairingDtoSchema.parse(await(await request('POST','/agents/pairing',{label:'Agente AUTO fixture'},crypto.randomUUID(),201)).json());
  const visited:string[]=[];const transport:typeof fetch=async(url,init)=>{const target=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url);if(target.origin!==h!.origin)throw new Error('EXTERNAL_NETWORK_FORBIDDEN');visited.push(target.pathname);return h!.fetch(target.pathname+target.search,init);};
  const token=await new AgentClient(h.origin,'',transport).pair(code.code,'Agente AUTO fixture',{ffprobe:true,localImport:true,alignment:false,render:true},crypto.randomUUID());let agent=new AgentClient(h.origin,token.token,transport);const config={origin:h.origin,mediaRoot:join(root,'media'),...token,ffprobe:defaultProbePath()};await agent.heartbeat(config.mediaRoot,config.ffprobe);
  const tone=await new MockVoiceAdapter().start({durationMs:5000},{ownerId:owner,projectId:id,idempotencyKey:crypto.randomUUID(),timeoutMs:1000,signal:AbortSignal.timeout(1000)});expect(tone.speech).toBe(false);expect(tone.simulated).toBe(true);const voicePath=join(root,'tone.wav');const imagePath=join(root,'image.png');await writeFile(voicePath,tone.bytes);await writeFile(imagePath,pngFixture());
  const audio=await importLocalFile(agent,config,{file:voicePath,projectId:id,mime:'audio/wav',source:'MockVoiceAdapter: tono sintético, speech=false, fixture propio',rights:true});const image=await importLocalFile(agent,config,{file:imagePath,projectId:id,mime:'image/png',source:'PNG sintético propio de fixture',rights:true});expect(audio.durationMs).toBe(5000);
  async function pending(kind:'VOICE'|'ASSET'){
    for(let tick=0;tick<12;tick++){await advanceCoordinator(h!.db);const all=(await jobs.list(owner,{projectId:id})).items;const row=all.find((j)=>j.kind===kind&&['PENDING','READY','WAITING_MANUAL'].includes(j.status));if(row){await jobs.tick(owner,id);await prepareJob(h!.db,owner,row.id);const ready=(await jobs.get(owner,row.id))!;if(ready.status==='WAITING_MANUAL')return ready;}}
    throw new Error(`NO_PENDING_${kind}`);
  }
  async function approveResult(jobId:string,result:unknown){const current=(await jobs.get(owner,jobId))!;const key=crypto.randomUUID();const body={expectedRevision:current.revision,result};const saved=jobDtoSchema.parse(await(await request('POST',`/jobs/${jobId}/manual`,body,key)).json());expect(jobDtoSchema.parse(await(await request('POST',`/jobs/${jobId}/manual`,body,key)).json())).toEqual(saved);const checkpoint=(await jobs.checkpoints(owner,id)).find((c)=>c.jobId===jobId)!;expect(checkpoint.subjectVersionId).toBe(saved.outputRef!.id);await request('POST',`/checkpoints/${checkpoint.id}/approve`,{expectedRevision:checkpoint.revision,subjectVersionId:checkpoint.subjectVersionId});}
  let voice=await pending('VOICE');if(options.recover){await request('POST',`/projects/${id}/pause`,{expectedRevision:(await jobs.project(owner,id)).revision},crypto.randomUUID(),202);expect((await jobs.project(owner,id)).pause_requested).toBe(1);await request('POST',`/jobs/${voice.id}/manual`,{expectedRevision:(await jobs.get(owner,voice.id))!.revision,result:{kind:'VOICE',assetId:audio.id}},crypto.randomUUID(),409);await request('POST',`/projects/${id}/resume`,{expectedRevision:(await jobs.project(owner,id)).revision},crypto.randomUUID(),202);voice=await pending('VOICE');await request('POST',`/jobs/${voice.id}/manual`,{expectedRevision:voice.revision,result:{kind:'VOICE',assetId:image.id}},crypto.randomUUID(),409);}const base=(await catalog.getSceneVersion(owner,id,(await catalog.getScene(owner,id,scene.id))!.activeVersionId!))!;await approveResult(voice.id,{kind:'VOICE',assetId:audio.id,segments:[{segmentIndex:0,text:base.narration,startMs:0,endMs:5000}]});
  const visual=await pending('ASSET');const voiced=(await catalog.getSceneVersion(owner,id,(await catalog.getScene(owner,id,scene.id))!.activeVersionId!))!;await approveResult(visual.id,{kind:'ASSET',assets:voiced.shots.map((s)=>({shotOrder:s.orderIndex,assetId:image.id}))});
  if(options.recover){
    const previous=(await catalog.getSceneVersion(owner,id,(await catalog.getScene(owner,id,scene.id))!.activeVersionId!))!;
    const sceneInput=new ManualRepository(h.db).sceneInput(previous);sceneInput.shots=sceneInput.shots.map((s)=>({...s,prompt:`Corrección localizada de fixture: ${s.prompt}`}));
    const candidate=contentMutationSchema.parse(await(await request('PATCH',`/scenes/${scene.id}`,{expectedRevision:(await jobs.project(owner,id)).revision,baseVersionId:previous.id,input:sceneInput},crypto.randomUUID(),201)).json());expect((await catalog.getScene(owner,id,scene.id))!.activeVersionId).toBe(previous.id);
    await request('POST',`/scenes/${scene.id}/versions/${candidate.versionId}/activate`,{expectedRevision:candidate.revision,acknowledgeImpact:true});const corrected=(await catalog.getSceneVersion(owner,id,candidate.versionId))!;expect(corrected.narration).toBe(previous.narration);expect(corrected.assetLinks.map((a)=>a.assetId)).toEqual(previous.assetLinks.map((a)=>a.assetId));expect((await catalog.getSceneVersion(owner,id,previous.id))!.contentHash).toBe(previous.contentHash);
  }
  for(let tick=0;tick<4;tick++)await advanceCoordinator(h.db);
  const saved=contentMutationSchema.parse(await(await request('POST',`/projects/${id}/manifests`,{expectedRevision:(await jobs.project(owner,id)).revision},crypto.randomUUID(),201)).json());await request('POST',`/projects/${id}/manifests/${saved.versionId}/activate`,{expectedRevision:saved.revision,acknowledgeImpact:true});
  const manifest=(await h.db.prepare('SELECT content_hash FROM render_manifests WHERE id=?').bind(saved.versionId).first<{content_hash:string}>())!;
  const qa=qaReportSchema.parse(await(await request('POST',`/projects/${id}/qa/run`,{expectedRevision:(await jobs.project(owner,id)).revision,manifestHash:manifest.content_hash})).json());expect(qa.findings.some((f)=>f.severity==='BLOCKER')).toBe(false);await request('POST',`/projects/${id}/qa/${qa.id}/approve`,{expectedRevision:qa.revision,manifestHash:qa.manifestHash,acknowledgeEditorialReview:true});
  const render=jobDtoSchema.parse(await(await request('POST',`/projects/${id}/render`,{expectedRevision:(await jobs.project(owner,id)).revision,manifestHash:manifest.content_hash},crypto.randomUUID(),202)).json());
  // A fresh client resumes from persisted API/config state; there is no user browser.
  const persisted=await readConfig();agent=new AgentClient(persisted.origin,persisted.token!,transport);const lease=agentClaimResponseSchema.parse(await agent.call('/agents/jobs/claim',agentClaimResponseSchema,{availableSlots:1})).lease!;expect(lease.job.id).toBe(render.id);
  await executeRender(agent,config.mediaRoot,lease,config.ffprobe,undefined,(mediaRoot,task,attempt,files,options)=>localRender(mediaRoot,task,attempt,files,{...options,chrome:chrome!,bundle:composition!,development:true}));expect((await jobs.get(owner,render.id))!.status).toBe('SUCCEEDED');
  const row=(await h.db.prepare('SELECT id,checksum FROM renders WHERE job_id=?').bind(render.id).first<{id:string;checksum:string}>())!;
  const view=youtubeViewSchema.parse(await(await request('GET',`/projects/${id}/renders/${row.id}/youtube`)).json());expect(view.render.technical?.frames).toBe(150);expect(view.render.technical?.analysisVersion).toBe(1);expect(view.draft.chapters[0]!.startMs).toBe(0);
  const pack=youtubePackageSchema.parse(await(await request('POST',`/projects/${id}/renders/${row.id}/youtube`,{expectedRevision:view.revision,metadata:{...view.draft,description:'Fixture simulado con tono; sin voz hablada ni hechos verificados.'},acknowledgeReview:true},crypto.randomUUID(),201)).json());const destination=join(root,'export');await exportFromAgent(agent,config.mediaRoot,id,pack.id,destination);
  const mp4=await probeFile(join(destination,'video.mp4'),'video/mp4');expect(mp4).toMatchObject({width:1920,height:1080,checksum:row.checksum});expect(Math.abs(mp4.durationMs!-5000)).toBeLessThanOrEqual(34);const exported=youtubeExportSchema.parse(JSON.parse(await readFile(join(destination,'youtube.json'),'utf8')));expect(exported.package.id).toBe(pack.id);expect(exported.manifest.scriptVersionId).toBe(script.id);expect((await fileHash(join(destination,'video.mp4'))).checksum).toBe(pack.renderChecksum);expect(JSON.parse(await readFile(join(destination,'COMPLETE.json'),'utf8'))).toHaveProperty('packageId',pack.id);
  expect((await jobs.project(owner,id)).status).toBe('COMPLETED');expect(jobsListSchema.parse(await(await request('GET',`/jobs?projectId=${id}`)).json()).items.every((j)=>['SUCCEEDED','STALE'].includes(j.status))).toBe(true);
  expect((await h.db.prepare('SELECT count(*) AS n FROM usage_records WHERE project_id=?').bind(id).first<{n:number}>())!.n).toBe(options.inputType==='SCRIPT'?2:3);
  const money=await h.db.prepare("SELECT count(*) AS n FROM usage_records WHERE project_id=? AND (amount_micros<>0 OR status<>'SETTLED')").bind(id).first<{n:number}>();expect(money!.n).toBe(0);expect((await h.db.prepare('SELECT sum(external_started) AS n FROM job_attempts WHERE job_id IN(SELECT id FROM jobs WHERE project_id=?)').bind(id).first<{n:number}>())!.n).toBe(0);expect(visited).toContain(`/api/v1/agents/jobs/${render.id}/render-complete`);expect(visited).toContain(`/api/v1/agents/projects/${id}/exports/${pack.id}`);

  if(options.afterComplete)await options.afterComplete({h,root,mediaRoot:config.mediaRoot,project:id,owner,password,cookie,exported,composition:composition!,close:async()=>{await h!.dispose();h=undefined;}});
  }finally{await h?.dispose();vi.unstubAllEnvs();if(root)await safeCleanup(root,'video-studio-auto-test-');}
}
