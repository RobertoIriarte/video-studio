import type {} from '../../../packages/render/src/remotion-types.js';
import { renderMedia, selectComposition, makeCancelSignal } from '@remotion/renderer';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, link, readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { renderArtifactSchema, uuidSchema, contentHashSchema } from '@video-studio/contracts';
import type { renderAssignmentSchema } from '@video-studio/contracts';
import { cacheRoot, contained, diskFree, fileHash } from './cache.js';
import { inspectRender, normalizeAudio, defaultFfmpeg, OutputQaError } from './media-processing.js';
import { defaultProbePath } from './probe.js';
import { serveAssets } from './asset-server.js';
export class LocalRenderError extends Error { constructor(readonly code:'DISK_FULL'|'LOCAL_FILE_MISSING'|'RENDER_FAILED',stage?:string) {super(stage ? `${code}:${stage}` : code);} }
export const compositionBundle = () => fileURLToPath(new URL('../dist/composition',import.meta.url));
export async function defaultChrome() {
  if (process.env.VIDEO_STUDIO_CHROME_PATH) return process.env.VIDEO_STUDIO_CHROME_PATH;
  const parent=join(process.env.LOCALAPPDATA ?? join(homedir(),'.cache'),'ms-playwright');
  for (const name of (await readdir(parent).catch(()=>[])).filter((n)=>/^chromium-\d+$/.test(n)).sort((a,b)=>Number(b.slice(9))-Number(a.slice(9)))) {
    const path=join(parent,name,process.platform === 'win32' ? 'chrome-win64/chrome.exe' : process.platform === 'darwin' ? 'chrome-mac/Chromium.app/Contents/MacOS/Chromium' : 'chrome-linux/chrome'); if (existsSync(path)) return path;
  } return undefined;
}
export async function renderReady(probe=defaultProbePath(),chrome?:string) { const browser=chrome ?? await defaultChrome(); return !!browser && isAbsolute(browser) && existsSync(browser) && existsSync(defaultFfmpeg(probe)) && existsSync(compositionBundle()); }
export async function renderDirectory(root:string,project:string,id:string,attempt?:string) { let dir=await cacheRoot(root); const base=dir; const parts=['projects',uuidSchema.parse(project),'renders',uuidSchema.parse(id),...(attempt ? ['attempts',uuidSchema.parse(attempt)] : [])]; for (const part of parts) {dir=contained(base,join(dir,part));await mkdir(dir,{mode:0o700}).catch((e:unknown)=>{if (!(e && typeof e==='object' && 'code' in e && e.code==='EEXIST')) throw e;});const s=await lstat(dir);if (!s.isDirectory()||s.isSymbolicLink()) throw new LocalRenderError('LOCAL_FILE_MISSING');}return dir; }
const receiptSchema=z.strictObject({manifestHash:contentHashSchema,artifact:renderArtifactSchema});
export async function localRender(root:string,task:z.infer<typeof renderAssignmentSchema>,attemptId:string,files:Map<string,{path:string;bytes:number;mime:string}>,options:{probe?:string;chrome?:string;bundle?:string;signal?:AbortSignal;minFreeBytes?:number;development?:boolean;progress?:(completed:number,total:number,phase:string)=>void}={}) {
  options.signal?.throwIfAborted(); const dir=await renderDirectory(root,task.manifest.projectId,task.renderId,attemptId);const output=join(dir,'final.mp4');const receipt=join(dir,'receipt.json');
  if (existsSync(receipt)) {const prior=receiptSchema.parse(JSON.parse(await readFile(receipt,'utf8')));const s=await lstat(output);if (s.isSymbolicLink()||prior.manifestHash!==task.manifestHash||prior.artifact.renderId!==task.renderId||prior.artifact.outputAssetId!==task.outputAssetId||(await fileHash(output)).checksum!==prior.artifact.metadata.checksum) throw new LocalRenderError('LOCAL_FILE_MISSING');return prior.artifact;}
  const required=options.minFreeBytes ?? 256*1024**2+Math.ceil(task.manifest.durationInFrames/30)*1024**2; if (await diskFree(root)<required) throw new LocalRenderError('DISK_FULL');
  for (const a of task.manifest.assets) { const f=files.get(a.checksum);if (!f||!isAbsolute(f.path)) throw new LocalRenderError('LOCAL_FILE_MISSING');const s=await lstat(f.path); if (s.isSymbolicLink()||!s.isFile()||s.size!==a.bytes||(await fileHash(f.path)).checksum!==a.checksum) throw new LocalRenderError('LOCAL_FILE_MISSING'); }
  const probe=options.probe ?? defaultProbePath();const encoder=defaultFfmpeg(probe); const browser=options.chrome ?? await defaultChrome(); if (!browser||!isAbsolute(browser)||!existsSync(browser)) throw new LocalRenderError('RENDER_FAILED');
  const server=await serveAssets(files); const cancel=makeCancelSignal();const abort=()=>cancel.cancel();options.signal?.addEventListener('abort',abort,{once:true});
  let stage='COMPOSITION';
  try {
    if (!existsSync(output)) {
      const inputProps={manifest:task.manifest,sources:Object.fromEntries(task.manifest.assets.map((a)=>[a.id,server.url(a.checksum)]))}; const serveUrl=options.bundle ?? compositionBundle();
      const composition=await selectComposition({serveUrl,id:'VideoStudio',inputProps,browserExecutable:browser,logLevel:'error'});
      stage='FRAMES';const raw=join(dir,'raw.partial.mp4'); await renderMedia({serveUrl,composition,inputProps,codec:'h264',audioCodec:'aac',pixelFormat:'yuv420p',colorSpace:'bt709',imageFormat:'png',outputLocation:raw,browserExecutable:browser,concurrency:2,x264Preset:'veryfast',crf:18,logLevel:'error',cancelSignal:cancel.cancelSignal,isProduction:options.development !== true,onProgress:(p)=>options.progress?.(p.renderedFrames,task.manifest.durationInFrames,'Renderizando frames')});
      options.progress?.(task.manifest.durationInFrames,task.manifest.durationInFrames,'Normalizando y verificando audio');stage='NORMALIZE';const normalized=join(dir,'normalized.partial.mp4');await normalizeAudio(raw,normalized,encoder,options.signal);
      stage='VERIFY';const inspected=await inspectRender(normalized,probe,encoder,options.signal);if (inspected.technical.frames!==task.manifest.durationInFrames||Math.abs(inspected.metadata.durationMs!-task.manifest.durationInFrames*1000/30)>34||inspected.technical.loudnessI < -16||inspected.technical.loudnessI > -12||inspected.technical.truePeakDbtp > -0.9) throw new LocalRenderError('RENDER_FAILED');
      await link(normalized,output); await unlink(normalized);
    }
    stage='RECEIPT';const inspected=await inspectRender(output,probe,encoder,options.signal);const artifact=renderArtifactSchema.parse({renderId:task.renderId,outputAssetId:task.outputAssetId,...inspected});
    await writeFile(receipt,JSON.stringify({manifestHash:task.manifestHash,artifact}),{flag:'wx',mode:0o600});return artifact;
  } catch(e) {if (e instanceof OutputQaError || e instanceof LocalRenderError || options.signal?.aborted) throw e;throw new LocalRenderError('RENDER_FAILED',`${stage}:${e instanceof z.ZodError ? e.issues.map((i)=>i.path.join('.')).join(',') : e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : e instanceof Error ? e.name : 'Unknown'}`);} finally {options.signal?.removeEventListener('abort',abort);await server.close();}
}
export async function locateRender(root:string,project:string,id:string,expectedChecksum?:string) {const base=await renderDirectory(root,project,id);const attempts=join(base,'attempts');for (const name of (await readdir(attempts)).reverse()) {if (!uuidSchema.safeParse(name).success) continue; const dir=await renderDirectory(root,project,id,name);try {const data=receiptSchema.parse(JSON.parse(await readFile(join(dir,'receipt.json'),'utf8')));const path=resolve(dir,'final.mp4');const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())continue;if ((!expectedChecksum||data.artifact.metadata.checksum===expectedChecksum)&&(await fileHash(path)).checksum===data.artifact.metadata.checksum) return path;}catch{ /* Other attempts may remain partial; never publish them. */ }}throw new LocalRenderError('LOCAL_FILE_MISSING');}
