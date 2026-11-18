import { renderRecordSchema, renderManifestSchema, youtubeSaveSchema, youtubePackageSchema, scriptOutputSchema, youtubeExportSchema } from '@video-studio/contracts';
import { validateYoutubeTimeline, youtubeDraft, youtubeDescription } from '@video-studio/domain';
import type { Database } from './connection.js';
import { JobRepository, JobConflict, JobNotFound, defaultJobRuntime, batchChanges } from './jobs.js';
import type { JobRuntime } from './jobs.js';
import { catalogHash, CatalogRepository } from './catalog.js';
import { JobRunnerRepository } from './job-runner.js';
export class YoutubeRepository {
  readonly jobs:JobRepository;
  constructor(readonly db:Database,readonly runtime:JobRuntime=defaultJobRuntime){this.jobs=new JobRepository(db,runtime);}
  async render(owner:string,project:string,id:string){
    await this.jobs.project(owner,project);
    const r=await this.db.prepare("SELECT * FROM renders WHERE id=? AND project_id=? AND status='SUCCEEDED' AND EXISTS(SELECT 1 FROM qa_reports q WHERE q.render_id=renders.id AND q.kind='FINAL' AND q.status='APPROVED' AND q.version_no=(SELECT max(version_no) FROM qa_reports WHERE render_id=renders.id AND kind='FINAL'))").bind(id,project).first<Record<string,unknown>>();if(!r)throw new JobNotFound();
    const render=renderRecordSchema.parse({id:r.id,projectId:project,jobId:r.job_id,manifestId:r.manifest_id,manifestHash:r.manifest_hash,versionNo:r.version_no,status:r.status,outputAssetId:r.output_asset_id,checksum:r.checksum,durationMs:r.duration_ms,technical:JSON.parse(String(r.technical_json)),createdAt:r.created_at});
    return{render,manifest:renderManifestSchema.parse(JSON.parse(String(r.manifest_json)))};
  }
  async view(owner:string,project:string,renderId:string,cursor?:string){
    const state=await this.jobs.project(owner,project);const context=await this.render(owner,project,renderId);const before=cursor?Number(cursor):Number.MAX_SAFE_INTEGER;if(!Number.isSafeInteger(before)||before<1)throw new JobConflict();
    const script=await new CatalogRepository(this.db).getScript(owner,project,context.manifest.scriptVersionId);if(!script)throw new JobNotFound();const data=scriptOutputSchema.parse(script.data);
    const rows=await this.db.prepare('SELECT id,stable_key FROM scenes WHERE project_id=?').bind(project).all<{id:string;stable_key:string}>();
    const packages=await this.db.prepare('SELECT package_json,version_no FROM youtube_packages WHERE render_id=? AND version_no<? ORDER BY version_no DESC LIMIT 26').bind(renderId,before).all<{package_json:string;version_no:number}>();
    return{revision:state.revision,...context,draft:youtubeDraft(context.manifest,data.title,data.sections,new Map(rows.results.map((r)=>[r.id,r.stable_key]))),items:packages.results.slice(0,25).map((r)=>youtubePackageSchema.parse(JSON.parse(r.package_json))),nextCursor:packages.results.length>25?String(packages.results[24]!.version_no):null};
  }
  async get(owner:string,project:string,id:string){
    await this.jobs.project(owner,project);const row=await this.db.prepare('SELECT package_json FROM youtube_packages WHERE id=? AND project_id=?').bind(id,project).first<{package_json:string}>();if(!row)throw new JobNotFound();const pack=youtubePackageSchema.parse(JSON.parse(row.package_json));const context=await this.render(owner,project,pack.renderId);if(pack.manifestHash!==context.render.manifestHash||pack.renderChecksum!==context.render.checksum)throw new JobConflict();return youtubeExportSchema.parse({package:pack,...context});
  }
  async save(owner:string,project:string,renderId:string,operation:string,raw:unknown){
    const input=youtubeSaveSchema.parse(raw);const hash=await catalogHash({action:'SAVE_YOUTUBE',renderId,input});const previous=await this.jobs.receipt(owner,project,operation,hash);if(previous)return youtubePackageSchema.parse(previous);
    const {render,manifest}=await this.render(owner,project,renderId);try{validateYoutubeTimeline(manifest,input.metadata);}catch{throw new JobConflict();}if(youtubeDescription(input.metadata).length>5000)throw new JobConflict();
    const last=await this.db.prepare('SELECT COALESCE(max(version_no),0)+1 AS n FROM youtube_packages WHERE render_id=?').bind(renderId).first<{n:number}>();const id=this.runtime.uuid();const now=this.jobs.timestamp();const contentHash=await catalogHash({renderId,manifestHash:render.manifestHash,renderChecksum:render.checksum,metadata:input.metadata});
    const body=youtubePackageSchema.parse({id,projectId:project,renderId,manifestId:render.manifestId,manifestHash:render.manifestHash,renderChecksum:render.checksum,versionNo:last!.n,contentHash,metadata:input.metadata,createdAt:now});const g={sql:'EXISTS(SELECT 1 FROM projects WHERE id=? AND mutation_token=?)',values:[project,id]};
    try{if(batchChanges(await this.db.batch([
      this.db.prepare('UPDATE projects SET revision=revision+1,mutation_token=?,updated_at=max(updated_at,?),status=CASE WHEN status=\'READY_RENDER\' AND active_manifest_id=? AND active_manifest_id IN(SELECT id FROM render_ready_manifests) THEN \'COMPLETED\' ELSE status END WHERE id=? AND owner_id=? AND revision=? AND archived_at IS NULL AND EXISTS(SELECT 1 FROM renders r WHERE r.id=? AND r.project_id=projects.id AND r.status=\'SUCCEEDED\' AND r.checksum=?)').bind(id,now,render.manifestId,project,owner,input.expectedRevision,renderId,render.checksum),
      this.db.prepare(`INSERT INTO youtube_packages SELECT ?,?,?,?,?,?,? WHERE ${g.sql}`).bind(id,project,renderId,body.versionNo,contentHash,JSON.stringify(body),now,...g.values),
      this.db.prepare(`INSERT INTO job_commands SELECT ?,?,?,? WHERE ${g.sql}`).bind(project,operation,hash,JSON.stringify(body),...g.values),
    ]))!==1)throw new JobConflict();}catch(e){const replay=await this.jobs.receipt(owner,project,operation,hash);if(replay)return youtubePackageSchema.parse(replay);throw e;}
    await new JobRunnerRepository(this.db,this.runtime).reconcileProject(owner,project);return body;
  }
}
