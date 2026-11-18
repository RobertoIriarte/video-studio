import { renderStartSchema, jobDtoSchema, renderListSchema, renderAssignmentSchema, renderCompleteSchema, renderQaFailureSchema, qaFindingSchema } from '@video-studio/contracts';
import type { Database } from './connection.js';
import type { QaFinding } from '@video-studio/contracts';
import { JobRepository, JobConflict, JobNotFound, batchChanges, defaultJobRuntime, jobJsonSql } from './jobs.js';
import type { JobRuntime } from './jobs.js';
import { ManifestRepository, currentManifestSql } from './manifests.js';
import { catalogHash } from './catalog.js';
import { JobRunnerRepository } from './job-runner.js';
export class RenderRepository {
  readonly jobs: JobRepository; readonly manifests: ManifestRepository;
  constructor(readonly db: Database, readonly runtime: JobRuntime = defaultJobRuntime) { this.jobs = new JobRepository(db,runtime); this.manifests = new ManifestRepository(db,runtime); }
  async list(owner: string, project: string, cursor?: string) {
    await this.jobs.project(owner,project); const before = cursor ? Number(cursor) : Number.MAX_SAFE_INTEGER; if (!Number.isSafeInteger(before) || before < 1) throw new JobConflict();
    const rows = await this.db.prepare('SELECT * FROM renders WHERE project_id=? AND version_no<? ORDER BY version_no DESC LIMIT 26').bind(project,before).all<Record<string, unknown>>();
    return renderListSchema.parse({ items: rows.results.slice(0,25).map((r) => ({ id:r.id,projectId:project,jobId:r.job_id,manifestId:r.manifest_id,manifestHash:r.manifest_hash,versionNo:r.version_no,status:r.status,outputAssetId:r.output_asset_id,checksum:r.checksum,durationMs:r.duration_ms,technical:r.technical_json ? JSON.parse(String(r.technical_json)) : null,createdAt:r.created_at })), nextCursor: rows.results.length > 25 ? String(rows.results[24]!.version_no) : null });
  }
  async start(owner: string, project: string, operation: string, raw: unknown) {
    const input = renderStartSchema.parse(raw); const hash = await catalogHash({ action:'START_RENDER',project,input }); const previous = await this.jobs.receipt(owner,project,operation,hash); if (previous) return jobDtoSchema.parse(previous);
    const row = await this.db.prepare('SELECT active_manifest_id FROM projects WHERE id=? AND owner_id=?').bind(project,owner).first<{ active_manifest_id: string | null }>(); if (!row?.active_manifest_id) throw new JobConflict(); const m = await this.manifests.get(owner,project,row.active_manifest_id);
    if (m.contentHash !== input.manifestHash || m.manifest.assets.some((a) => a.license.rightsAcknowledged !== true || !a.license.source)) throw new JobConflict();
    const id = this.runtime.uuid(); const renderId = this.runtime.uuid(); const outputAssetId = this.runtime.uuid(); const now = this.jobs.timestamp();
    const payload = { renderId,manifestId:m.id,manifestHash:m.contentHash,outputAssetId }; const refs = [{ kind:'SCRIPT',id:m.manifest.scriptVersionId,hash:m.manifest.scriptHash }];
    const job = jobDtoSchema.parse({ id,projectId:project,sceneId:null,kind:'RENDER',executionTarget:'LOCAL',status:'PENDING',revision:1,attempt:0,maxAttempts:3,nextRunAt:null,progress:{message:'Esperando render local.'},error:null,outputRef:null,createdAt:now,updatedAt:now });
    const g = { sql:'EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_id=? AND mutation_token=?)',values:[project,owner,id] };
    try { if (batchChanges(await this.db.batch([
      this.db.prepare(`UPDATE projects SET revision=revision+1,updated_at=max(updated_at,?),status='RENDERING',mutation_token=? WHERE id=? AND owner_id=? AND revision=? AND archived_at IS NULL AND pause_requested=0 AND status='READY_RENDER' AND active_manifest_id=? AND EXISTS(SELECT 1 FROM render_manifests m WHERE m.id=? AND m.status='APPROVED' AND ${currentManifestSql()}) AND active_manifest_id IN(SELECT id FROM render_ready_manifests) AND NOT EXISTS(SELECT 1 FROM jobs WHERE project_id=? AND kind='RENDER' AND status IN('PENDING','READY','RUNNING','RETRY_SCHEDULED','WAITING_RESOURCE','FAILED'))`).bind(now,id,project,owner,input.expectedRevision,m.id,m.id,project),
      this.db.prepare(`INSERT INTO jobs (id,project_id,scene_id,kind,execution_target,status,payload_json,input_refs_json,idempotency_key,input_hash,attempt_count,max_attempts,progress_json,revision,created_at,updated_at) SELECT ?,?,NULL,'RENDER','LOCAL','PENDING',?,?,?,?,0,3,?,1,?,? WHERE ${g.sql}`).bind(id,project,JSON.stringify(payload),JSON.stringify(refs),operation,hash,JSON.stringify(job.progress),now,now,...g.values),
      this.db.prepare(`INSERT INTO renders SELECT ?,?,?,?,?,?,'FHD_MP4',COALESCE(max(version_no),0)+1,'QUEUED',NULL,NULL,NULL,NULL,? FROM renders WHERE project_id=? HAVING ${g.sql}`).bind(renderId,project,id,m.id,m.contentHash,JSON.stringify(m.manifest),now,project,...g.values),
      this.db.prepare(`INSERT INTO job_commands SELECT ?,?,?,? WHERE ${g.sql}`).bind(project,operation,hash,JSON.stringify(job),...g.values),
      this.db.prepare(`INSERT INTO activity_events SELECT ?,?,?,?,'USER',?,'JOB_CREATED','{}',? WHERE ${g.sql}`).bind(this.runtime.uuid(),owner,project,id,owner,now,...g.values),
    ])) !== 1) throw new JobConflict(); } catch (e) { const replay = await this.jobs.receipt(owner,project,operation,hash); if (replay) return jobDtoSchema.parse(replay); throw e; }
    return job;
  }
  async assignment(owner: string, jobId: string) {
    const job = await this.jobs.get(owner,jobId); if (!job || job.kind !== 'RENDER') throw new JobNotFound(); const r = await this.db.prepare("SELECT r.*,json_extract(j.payload_json,'$.outputAssetId') AS asset_id FROM renders r JOIN jobs j ON j.id=r.job_id WHERE r.job_id=?").bind(jobId).first<Record<string,unknown>>(); if (!r) throw new JobNotFound();
    return renderAssignmentSchema.parse({renderId:r.id,outputAssetId:r.asset_id,manifestHash:r.manifest_hash,manifest:JSON.parse(String(r.manifest_json))});
  }
  async failQa(owner:string,jobId:string,raw:unknown,agent?:string,operation?:string){
    const input=renderQaFailureSchema.parse(raw);const task=await this.assignment(owner,jobId);if(task.renderId!==input.renderId)throw new JobConflict();const job=(await this.jobs.get(owner,jobId))!;const record=(await this.db.prepare('SELECT manifest_id FROM renders WHERE id=?').bind(task.renderId).first<{manifest_id:string}>())!;
    const commandHash=operation?await catalogHash({action:'RENDER_QA_FAIL',input:{id:jobId,input}}):null;
    const sceneAt=(ms:number|null)=>ms===null?null:task.manifest.scenes.find((s)=>ms>=s.startFrame*1000/30&&ms<(s.startFrame+s.durationInFrames)*1000/30)?.sceneId??null;
    const findings:QaFinding[]=[];
    if(input.analysis.blackFrameMs>200)findings.push(qaFindingSchema.parse({id:'BLACK_FRAMES:output',code:'BLACK_FRAMES',severity:'BLOCKER',sceneId:sceneAt(input.analysis.blackStartMs),assetId:null,component:'OUTPUT',message:'Se detectaron frames negros en la salida. Corrige el recurso visual de la escena y crea una candidata.',suggestedScope:'VISUAL'}));
    if(input.analysis.longestSilenceMs>2000)findings.push(qaFindingSchema.parse({id:'EXCESSIVE_SILENCE:output',code:'EXCESSIVE_SILENCE',severity:'BLOCKER',sceneId:sceneAt(input.analysis.silenceStartMs),assetId:null,component:'OUTPUT',message:'Silencio de más de dos segundos en la salida; revisa voz, trims y mezcla.',suggestedScope:'VOICE'}));
    if(!findings.length)findings.push(qaFindingSchema.parse({id:'OUTPUT_PROFILE:output',code:'OUTPUT_PROFILE',severity:'BLOCKER',sceneId:null,assetId:null,component:'OUTPUT',message:'La salida no pasó perfil, decodificación o medición de audio. Revisa el diagnóstico local antes de reintentar.',suggestedScope:null}));
    return new JobRunnerRepository(this.db,this.runtime).fail(owner,jobId,input.leaseToken,'RENDER_FAILED',0,false,{before:()=>[],after:(g)=>[...(operation?[this.db.prepare(`UPDATE agent_commands SET response_json=(SELECT ${jobJsonSql()} FROM jobs j WHERE j.id=?) WHERE agent_id=? AND operation_id=? AND request_hash=? AND response_json IS NULL AND ${g.sql}`).bind(jobId,agent!,operation,commandHash,...g.values)]:[]),this.db.prepare(`INSERT INTO qa_reports (id,project_id,manifest_id,manifest_hash,render_id,kind,version_no,status,revision,findings_json,created_at) SELECT ?,?,?,?,?,'FINAL',COALESCE(max(version_no),0)+1,'BLOCKED',1,?,? FROM qa_reports WHERE project_id=? HAVING ${g.sql}`).bind(this.runtime.uuid(),job.projectId,record.manifest_id,task.manifestHash,task.renderId,JSON.stringify(findings),this.jobs.timestamp(),job.projectId,...g.values)]});
  }
  async publish(owner: string, agent: string, jobId: string, raw: unknown, operation?: string) {
    const input = renderCompleteSchema.parse(raw); const task = await this.assignment(owner,jobId); const job = (await this.jobs.get(owner,jobId))!;
    if (task.renderId !== input.renderId || task.outputAssetId !== input.outputAssetId || input.technical.frames !== task.manifest.durationInFrames || Math.abs(input.metadata.durationMs - task.manifest.durationInFrames * 1000/30)>34 || input.technical.loudnessI < -16 || input.technical.loudnessI > -12 || input.technical.truePeakDbtp > -0.9 || input.technical.analysisVersion!==1 || input.technical.blackFrameMs===undefined || input.technical.blackFrameMs>200 || input.technical.longestSilenceMs===undefined || input.technical.longestSilenceMs>2000) throw new JobConflict();
    const committed = await this.db.prepare("SELECT r.technical_json FROM renders r JOIN job_attempts a ON a.job_id=r.job_id WHERE r.id=? AND r.status='SUCCEEDED' AND r.output_asset_id=? AND r.checksum=? AND a.lease_token=? AND a.status='SUCCEEDED'").bind(task.renderId,input.outputAssetId,input.metadata.checksum,input.leaseToken).first<{technical_json:string}>();
    if(committed){if(committed.technical_json!==JSON.stringify(input.technical))throw new JobConflict();return job;}
    const manifestId=(await this.db.prepare('SELECT manifest_id FROM renders WHERE id=?').bind(task.renderId).first<{manifest_id:string}>())!.manifest_id;
    const commandHash = operation ? await catalogHash({action:'RENDER_COMPLETE',input:{id:jobId,input}}) : null;
    return new JobRunnerRepository(this.db,this.runtime).publishContent(owner,jobId,input.leaseToken,{kind:'ASSET',id:input.outputAssetId,hash:input.metadata.checksum},{ before:(g) => [
      this.db.prepare(`INSERT INTO assets (id,project_id,owner_id,type,mime,bytes,checksum,duration_ms,width,height,origin,license_json,prompt,availability,created_at) SELECT ?,?,?,'VIDEO','video/mp4',?,?,?,?,?,'PROVIDER',?,NULL,'LOCAL_ONLY',? WHERE ${g.sql}`).bind(input.outputAssetId,job.projectId,owner,input.metadata.bytes,input.metadata.checksum,input.metadata.durationMs,1920,1080,JSON.stringify({source:'Render local Remotion/FFmpeg',rightsAcknowledged:true,manifestHash:task.manifestHash}),this.jobs.timestamp(),...g.values),
    ], after:(g) => [
      this.db.prepare(`UPDATE renders SET status='SUCCEEDED',output_asset_id=?,checksum=?,duration_ms=?,technical_json=? WHERE id=? AND status='QUEUED' AND ${g.sql}`).bind(input.outputAssetId,input.metadata.checksum,input.metadata.durationMs,JSON.stringify(input.technical),task.renderId,...g.values),
      ...(operation ? [this.db.prepare(`UPDATE agent_commands SET response_json=(SELECT ${jobJsonSql()} FROM jobs j WHERE j.id=?) WHERE agent_id=? AND operation_id=? AND request_hash=? AND response_json IS NULL AND ${g.sql}`).bind(jobId,agent,operation,commandHash,...g.values)] : []),
      this.db.prepare(`INSERT INTO qa_reports (id,project_id,manifest_id,manifest_hash,render_id,kind,version_no,status,revision,findings_json,created_at,reviewed_at) SELECT ?,?,?,?,?, 'FINAL',COALESCE(max(version_no),0)+1,'APPROVED',1,'[]',?,? FROM qa_reports WHERE project_id=? HAVING ${g.sql}`).bind(this.runtime.uuid(),job.projectId,manifestId,task.manifestHash,task.renderId,this.jobs.timestamp(),this.jobs.timestamp(),job.projectId,...g.values),
      this.db.prepare(`INSERT INTO asset_locations SELECT ?,?,?,?,? WHERE ${g.sql}`).bind(input.outputAssetId,job.projectId,owner,agent,this.jobs.timestamp(),...g.values),
    ] });
  }
}
