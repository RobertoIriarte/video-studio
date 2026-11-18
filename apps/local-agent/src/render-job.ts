import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { jobDtoSchema, renderAssignmentSchema } from '@video-studio/contracts';
import type { agentLeaseSchema } from '@video-studio/contracts';
import { assetDirectory, fileHash, saveDownloaded } from './cache.js';
import { probeFile } from './probe.js';
import { LocalRenderError, localRender } from './render.js';
import type { AgentClient } from './client.js';
import { OutputQaError } from './media-processing.js';
export async function executeRender(client: AgentClient, root: string, lease: z.infer<typeof agentLeaseSchema>, probe?:string, signal?:AbortSignal, render:typeof localRender=localRender) {
  const task=await client.call(`/agents/jobs/${lease.job.id}/render-input?leaseToken=${lease.leaseToken}`,renderAssignmentSchema); const controller=new AbortController();const external=()=>controller.abort();signal?.addEventListener('abort',external,{once:true}); if(signal?.aborted) controller.abort();
  let completed=0;let phase='Verificando recursos locales';let pause=false;let work:Promise<unknown>|null=null;
  const heartbeat=()=> { if(work) return;work=client.call(`/agents/jobs/${lease.job.id}/heartbeat`,z.object({pauseRequested:z.boolean()}),{leaseToken:lease.leaseToken,progress:{message:phase,completed,total:task.manifest.durationInFrames}}).then((r)=>{if(r.pauseRequested){pause=true;controller.abort();}}).catch(()=>controller.abort()).finally(()=>{work=null;}); };
  heartbeat();const timer=setInterval(heartbeat,15000);
  try {
    const files=new Map<string,{path:string;bytes:number;mime:string}>();
    for (const a of task.manifest.assets) {
      controller.signal.throwIfAborted();const dir=await assetDirectory(root,task.manifest.projectId,a.id);const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3','audio/ogg':'ogg'} as const)[a.mime];let path:string|undefined;
      for (const candidate of [join(dir,`source.${ext}`),join(dir,'inspection.bin')]) {try {const s=await lstat(candidate);if(!s.isSymbolicLink()&&s.isFile()&&s.size===a.bytes&&(await fileHash(candidate)).checksum===a.checksum){path=candidate;break;}}catch{/* A missing local candidate may have a remote copy. */}}
      if(!path) {
        const response=await client.transport(`${client.origin}/api/v1/agents/jobs/${lease.job.id}/render-assets/${a.id}?leaseToken=${lease.leaseToken}`,{headers:{authorization:`Bearer ${client.token}`},signal:controller.signal,redirect:'error'});if(!response.ok||!response.body) throw new LocalRenderError('LOCAL_FILE_MISSING');path=await saveDownloaded(root,task.manifest.projectId,a.id,response.body,a.bytes,a.checksum);
      }
      const actual=await probeFile(path,a.mime,probe);if(actual.checksum!==a.checksum||actual.type!==a.type||actual.width!==a.width||actual.height!==a.height||(a.durationMs!==null&&Math.abs(actual.durationMs!-a.durationMs)>50))throw new LocalRenderError('LOCAL_FILE_MISSING');files.set(a.checksum,{path,bytes:a.bytes,mime:a.mime});
    }
    const artifact=await render(root,task,lease.attemptId,files,{...(probe?{probe}:{}),signal:controller.signal,progress:(n,_total,message)=>{completed=n;phase=message;}});clearInterval(timer);if(work)await work;controller.signal.throwIfAborted();
    await client.call(`/agents/jobs/${lease.job.id}/render-complete`,jobDtoSchema,{...artifact,leaseToken:lease.leaseToken},lease.attemptId);
  }catch(error){
    if(pause) await client.call(`/agents/jobs/${lease.job.id}/pause`,jobDtoSchema,{leaseToken:lease.leaseToken});
    else if(error instanceof OutputQaError || error instanceof LocalRenderError&&error.code==='RENDER_FAILED')await client.call(`/agents/jobs/${lease.job.id}/render-qa-fail`,jobDtoSchema,{renderId:task.renderId,leaseToken:lease.leaseToken,reason:error instanceof OutputQaError?error.reason:'OUTPUT_PROFILE',analysis:error instanceof OutputQaError?error.analysis:{blackFrameMs:0,longestSilenceMs:0,blackStartMs:null,silenceStartMs:null}});
    else if(error instanceof LocalRenderError || controller.signal.aborted) await client.call(`/agents/jobs/${lease.job.id}/fail`,jobDtoSchema,{leaseToken:lease.leaseToken,code:error instanceof LocalRenderError ? error.code : 'TRANSIENT'});
    else throw error;
  }finally{clearInterval(timer);signal?.removeEventListener('abort',external);}
}
