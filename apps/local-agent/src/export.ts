import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { youtubeExportSchema, contentHashSchema, uuidSchema, bytesHash } from '@video-studio/contracts';
import { validateYoutubeTimeline, youtubeDescription } from '@video-studio/domain';
import { cacheRoot, diskFree, fileHash } from './cache.js';
import { locateRender } from './render.js';
import type { AgentClient } from './client.js';
const completeSchema=z.strictObject({packageId:uuidSchema,contentHash:contentHashSchema,files:z.record(z.enum(['video.mp4','manifest.json','youtube.json','description.txt']),contentHashSchema)});
export async function exportBundle(root:string,raw:unknown,destination:string){
  const bundle=youtubeExportSchema.parse(raw);const {package:pack,render,manifest}=bundle;
  if(render.status!=='SUCCEEDED'||pack.renderId!==render.id||pack.projectId!==manifest.projectId||pack.manifestHash!==render.manifestHash||pack.renderChecksum!==render.checksum||pack.manifestId!==render.manifestId||pack.projectId!==render.projectId||!render.outputAssetId)throw new Error('EXPORT_MISMATCH');validateYoutubeTimeline(manifest,pack.metadata);
  const documents={'manifest.json':JSON.stringify(manifest,null,2),'youtube.json':JSON.stringify(bundle,null,2),'description.txt':youtubeDescription(pack.metadata)};
  if(!isAbsolute(destination))throw new Error('ABSOLUTE_OUTPUT_REQUIRED');const output=resolve(destination);await cacheRoot(dirname(output));
  try{const info=await lstat(output);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('UNSAFE_OUTPUT');const receipt=completeSchema.parse(JSON.parse(await readFile(join(output,'COMPLETE.json'),'utf8')));if(receipt.packageId!==pack.id||receipt.contentHash!==pack.contentHash)throw new Error('EXPORT_EXISTS');for(const [name,checksum]of Object.entries(receipt.files)){const path=join(output,name);const expected=name==='video.mp4'?pack.renderChecksum:await bytesHash(new TextEncoder().encode(documents[name as keyof typeof documents]));if(checksum!==expected||(await lstat(path)).isSymbolicLink()||(await fileHash(path)).checksum!==checksum)throw new Error('EXPORT_CHANGED');}return output;}catch(e){if(!(e&&typeof e==='object'&&'code'in e&&e.code==='ENOENT'))throw e;const exists=await lstat(output).catch(()=>null);if(exists)throw new Error('INCOMPLETE_EXPORT_USE_NEW_DIRECTORY',{cause:e});}
  const video=await locateRender(root,pack.projectId,render.id,pack.renderChecksum);const source=await fileHash(video);if(await diskFree(dirname(output))<source.bytes+16*1024**2)throw new Error('DISK_FULL');
  // An exclusive directory and completion marker keep partial exports distinguishable; never overwrite user files.
  await mkdir(output,{mode:0o700});await copyFile(video,join(output,'video.mp4'),constants.COPYFILE_EXCL);
  for(const [name,content]of Object.entries(documents))await writeFile(join(output,name),content,{flag:'wx',mode:0o600});
  const files={} as Record<'video.mp4'|'manifest.json'|'youtube.json'|'description.txt',string>;for(const name of ['video.mp4','manifest.json','youtube.json','description.txt']as const)files[name]=(await fileHash(join(output,name))).checksum;
  if(files['video.mp4']!==pack.renderChecksum)throw new Error('EXPORT_CHANGED');await writeFile(join(output,'COMPLETE.json'),JSON.stringify({packageId:pack.id,contentHash:pack.contentHash,files}),{flag:'wx',mode:0o600});return output;
}
export async function exportFromAgent(client:AgentClient,root:string,project:string,packageId:string,destination:string){const bundle=await client.call(`/agents/projects/${uuidSchema.parse(project)}/exports/${uuidSchema.parse(packageId)}`,youtubeExportSchema);return exportBundle(root,bundle,destination);}
