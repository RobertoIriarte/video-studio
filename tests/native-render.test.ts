import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { assetSchema, sceneVersionSchema, bytesHash, renderAssignmentSchema } from '@video-studio/contracts';
import type { AssetDto } from '@video-studio/contracts';
import { compileManifest } from '@video-studio/domain';
import { pngFixture, wavFixture } from './support/media.js';
import { defaultProbePath } from '../apps/local-agent/src/probe.js';
import { defaultChrome, localRender, renderDirectory } from '../apps/local-agent/src/render.js';
import { serveAssets } from '../apps/local-agent/src/asset-server.js';
import { ffmpeg, inspectTimelineDefects, inspectRender, normalizeAudio, OutputQaError } from '../apps/local-agent/src/media-processing.js';
import { exportBundle } from '../apps/local-agent/src/export.js';
import { fileHash } from '../apps/local-agent/src/cache.js';
const execute=promisify(execFile);let root:string|undefined;let chrome:string|undefined;const probe=existsSync(defaultProbePath());
beforeAll(async()=>{chrome=await defaultChrome();if(probe&&chrome)await execute(process.execPath,['infra/scripts/build-composition.mjs'],{windowsHide:true,shell:false,timeout:180000,maxBuffer:2097152});},200000);
afterEach(async()=>{if(root){const target=resolve(root);if(!target.startsWith(resolve(tmpdir())+sep)||!basename(target).startsWith('video-studio-render-test-'))throw new Error('UNSAFE_CLEANUP');await rm(target,{recursive:true,force:true});root=undefined;}});
async function fixture(){root=await mkdtemp(join(tmpdir(),'video-studio-render-test-'));const project=crypto.randomUUID();const script=crypto.randomUUID();const scene=crypto.randomUUID();const now=new Date().toISOString();const files=new Map<string,{path:string;bytes:number;mime:string}>();const assets:AssetDto[]=[];
  for(const [type,mime,bytes] of [['IMAGE','image/png',pngFixture()],['AUDIO','audio/wav',wavFixture(10000)]] as const){const id=crypto.randomUUID();const checksum=await bytesHash(bytes);const path=join(root,id);await writeFile(path,bytes);files.set(checksum,{path,bytes:bytes.length,mime});assets.push(assetSchema.parse({id,projectId:project,type,mime,bytes:bytes.length,checksum,durationMs:type==='AUDIO'?10000:null,width:type==='IMAGE'?2:null,height:type==='IMAGE'?2:null,origin:'MANUAL',license:{source:'Fixture propio; tono',rightsAcknowledged:true},prompt:null,availability:'LOCAL_ONLY',createdAt:now}));}
  const version=sceneVersionSchema.parse({id:crypto.randomUUID(),projectId:project,sceneId:scene,scriptVersionId:script,parentVersionId:null,versionNo:1,status:'APPROVED',contentHash:'c'.repeat(64),createdAt:now,narration:'Fixture.',direction:{},durationMs:10000,generationScope:'ALL',shots:[0,1].map((i)=>({id:crypto.randomUUID(),orderIndex:i,durationMs:5000,type:'IMAGE',prompt:'Fixture',camera:{},transition:{type:i?'DISSOLVE':'CUT'},assetId:assets[0]!.id})),assetLinks:[{id:crypto.randomUUID(),assetId:assets[1]!.id,role:'VOICE',offsetMs:0,trimStartMs:0,trimEndMs:10000}],voiceSegments:[{audioAssetId:assets[1]!.id,segmentIndex:0,text:'Fixture.',startMs:0,endMs:10000,alignment:{method:'MANUAL',version:1}}]});
  const manifest=compileManifest(project,script,'d'.repeat(64),[version],assets,{shots:[],audio:[],overlays:[]});return{files,task:renderAssignmentSchema.parse({renderId:crypto.randomUUID(),outputAssetId:crypto.randomUUID(),manifestHash:'e'.repeat(64),manifest})};}
describe('F6-02 render local real',()=>{
  it('QA final real detecta negro y silencio; rechaza normalización de audio vacío',async({skip})=>{
    if(!probe)skip();root=await mkdtemp(join(tmpdir(),'video-studio-render-test-'));const path=join(root,'defects.mp4');
    await ffmpeg(['-y','-f','lavfi','-i','color=c=black:s=320x180:r=30:d=3','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path]);
    const analysis=await inspectTimelineDefects(path);expect(analysis.blackFrameMs).toBeGreaterThan(2800);expect(analysis.longestSilenceMs).toBeGreaterThan(2800);
    await expect(inspectRender(path)).rejects.toBeInstanceOf(OutputQaError);await expect(normalizeAudio(path,join(root,'rejected.mp4'))).rejects.toBeInstanceOf(OutputQaError);expect(existsSync(join(root,'rejected.mp4'))).toBe(false);
  },30000);
  it('MP4 sintético de 10 s, FHD/H264/AAC, loudnorm y recuperación inmutable',async({skip})=>{if(!probe||!chrome)skip();const {files,task}=await fixture();const attempt=crypto.randomUUID();let measured=0;
    const result=await localRender(root!,task,attempt,files,{chrome:chrome!,development:true,progress:(n)=>{measured=Math.max(measured,n);}});expect(result.metadata).toMatchObject({width:1920,height:1080});expect(Math.abs(result.metadata.durationMs-10000)).toBeLessThanOrEqual(34);expect(result.technical).toMatchObject({frames:300,videoCodec:'h264',audioCodec:'aac',pixelFormat:'yuv420p',fps:30});expect(result.technical.loudnessI).toBeGreaterThanOrEqual(-16);expect(result.technical.truePeakDbtp).toBeLessThanOrEqual(-0.9);expect(measured).toBe(300);
    expect(await localRender(root!,task,attempt,files,{chrome:chrome!,development:true})).toEqual(result);
    const second=await localRender(root!,task,crypto.randomUUID(),files,{chrome:chrome!,development:true});expect(second.metadata.checksum).toBe(result.metadata.checksum);
    const pack={id:crypto.randomUUID(),projectId:task.manifest.projectId,renderId:task.renderId,manifestId:crypto.randomUUID(),manifestHash:task.manifestHash,renderChecksum:result.metadata.checksum,versionNo:1,contentHash:'f'.repeat(64),createdAt:new Date().toISOString(),metadata:{title:'Exportación nativa',description:'Fixture con tono, sin voz hablada.',tags:[],chapters:task.manifest.scenes.map((s)=>({sceneId:s.sceneId,startMs:Math.floor(s.startFrame*1000/30),title:'Inicio'})),thumbnailIdeas:[],disclosureSuggestions:[]}};
    const bundle={package:pack,manifest:task.manifest,render:{id:task.renderId,projectId:task.manifest.projectId,jobId:crypto.randomUUID(),manifestId:pack.manifestId,manifestHash:task.manifestHash,versionNo:1,status:'SUCCEEDED',outputAssetId:task.outputAssetId,checksum:result.metadata.checksum,durationMs:result.metadata.durationMs,technical:result.technical,createdAt:pack.createdAt}};
    const directory=join(root!,'export');expect(await exportBundle(root!,bundle,directory)).toBe(directory);expect((await fileHash(join(directory,'video.mp4'))).checksum).toBe(result.metadata.checksum);expect(JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'))).toEqual(task.manifest);expect(await exportBundle(root!,bundle,directory)).toBe(directory);
    await writeFile(join(directory,'description.txt'),'Modificado por propietario');await expect(exportBundle(root!,bundle,directory)).rejects.toThrow('EXPORT_CHANGED');await expect(exportBundle(root!,{...bundle,package:{...pack,renderChecksum:'0'.repeat(64)}},join(root!,'mismatch'))).rejects.toThrow('EXPORT_MISMATCH');
  },240000);
  it('sin espacio o cancelado durante frames no publica final ni receipt; retry en nuevo intento',async({skip})=>{if(!probe||!chrome)skip();const {files,task}=await fixture();const full=crypto.randomUUID();await expect(localRender(root!,task,full,files,{chrome:chrome!,development:true,minFreeBytes:Number.MAX_SAFE_INTEGER})).rejects.toThrow('DISK_FULL');
    const attempt=crypto.randomUUID();const stop=new AbortController();let cancelledAt=0;await expect(localRender(root!,task,attempt,files,{chrome:chrome!,development:true,signal:stop.signal,progress:(n)=>{if(n>=5){cancelledAt=n;stop.abort();}}})).rejects.toThrow();expect(cancelledAt).toBeGreaterThanOrEqual(5);const directory=await renderDirectory(root!,task.manifest.projectId,task.renderId,attempt);expect(existsSync(join(directory,'receipt.json'))).toBe(false);expect(existsSync(join(directory,'final.mp4'))).toBe(false);
    const recovered=await localRender(root!,task,crypto.randomUUID(),files,{chrome:chrome!,development:true});expect(recovered.technical.frames).toBe(300);
  },240000);
  it('servidor efímero solo permite hashes autorizados y rangos válidos',async()=>{const {files}=await fixture();const checksum=[...files.keys()][0]!;const server=await serveAssets(files);try{const url=server.url(checksum);expect((await fetch(url,{headers:{range:'bytes=0-1'}})).status).toBe(206);expect((await fetch(url.replace(checksum,'0'.repeat(64)))).status).toBe(404);expect((await fetch(url,{headers:{range:'bytes=99999999-'}})).status).toBe(416);expect((await lstat(files.get(checksum)!.path)).isFile()).toBe(true);}finally{await server.close();}});
});
