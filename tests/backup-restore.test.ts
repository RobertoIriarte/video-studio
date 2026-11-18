import { afterAll,beforeAll,expect,it } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { bytesHash,importDtoSchema,assetSchema,assetAccessSchema,youtubeExportSchema,renderAssignmentSchema } from '@video-studio/contracts';
import { prepareProductionScenario,disposeProductionScenario,runProductionScenario } from './support/production-scenario.js';
import { authHarness } from './support/d1.js';
import { pngFixture } from './support/media.js';
import { createBackup,restoreBackup,verifyBackup } from '../apps/local-agent/src/backup.js';
import { localRender } from '../apps/local-agent/src/render.js';
import { assetDirectory,fileHash } from '../apps/local-agent/src/cache.js';
let ready=false;
beforeAll(async()=>{ready=await prepareProductionScenario();},200000);afterAll(disposeProductionScenario);
it('T22 · backup offline D1/R2/media, restauración aislada, referencias/versiones y MP4 reproducible',async({skip})=>{if(!ready)skip();await runProductionScenario({mode:'AUTO',inputType:'TOPIC',persist:true,afterComplete:async(ctx)=>{
  const headers={origin:ctx.h.origin,cookie:ctx.cookie,'content-type':'application/json','idempotency-key':crypto.randomUUID()};const png=pngFixture();const checksum=await bytesHash(png);
  const intent=await ctx.h.fetch('/api/v1/assets/import',{method:'POST',headers,body:JSON.stringify({projectId:ctx.project,mime:'image/png',bytes:png.length,checksum,license:{source:'Fixture R2 para restore',rightsAcknowledged:true,note:''},prompt:null})});expect(intent.status).toBe(201);const imported=importDtoSchema.parse(await intent.json());expect((await ctx.h.fetch(`/api/v1/imports/${imported.id}/content`,{method:'PUT',headers:{...headers,'content-type':'application/octet-stream'},body:new Uint8Array(png)})).status).toBe(200);
  const remote=assetSchema.parse(await(await ctx.h.fetch(`/api/v1/assets/${imported.id}/finalize`,{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:'{}'})).json());const before=(await ctx.h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(name,1,1)<>'_' ORDER BY name").all<{name:string}>()).results;const inventory:Record<string,number>={};for(const row of before)inventory[row.name]=(await ctx.h.db.prepare(`SELECT count(*) AS n FROM "${row.name.replaceAll('"','""')}"`).first<{n:number}>())!.n;
  await ctx.close();const snapshot=join(ctx.root,'backup');const output=join(ctx.root,'restored');const manifest=await createBackup(join(ctx.root,'state'),ctx.mediaRoot,snapshot,true);expect(manifest.files.some((f)=>f.path.startsWith('state/d1/'))).toBe(true);expect(manifest.files.some((f)=>f.path.startsWith('state/r2/'))).toBe(true);expect(manifest.files.some((f)=>f.path.endsWith('/final.mp4'))).toBe(true);expect(await verifyBackup(snapshot)).toEqual(manifest);await restoreBackup(snapshot,output);
  const restored=await authHarness({persistRoot:join(output,'state','v3'),existing:true});try{
    for(const [table,count]of Object.entries(inventory)){// Auth/session churn is checked after the inventory comparison.
      expect((await restored.db.prepare(`SELECT count(*) AS n FROM "${table.replaceAll('"','""')}"`).first<{n:number}>())!.n,table).toBe(count);
    }
    const login=await restored.fetch('/api/v1/auth/sign-in/email',{method:'POST',headers:{origin:restored.origin,'content-type':'application/json'},body:JSON.stringify({email:'auto@example.invalid',password:ctx.password})});expect(login.status).toBe(200);const cookie=login.headers.getSetCookie().map((v)=>v.split(';')[0]).join('; ');
    const bundle=youtubeExportSchema.parse(await(await restored.fetch(`/api/v1/projects/${ctx.project}/exports/${ctx.exported.package.id}`,{headers:{cookie}})).json());expect(bundle).toEqual(ctx.exported);const access=assetAccessSchema.parse(await(await restored.fetch(`/api/v1/assets/${remote.id}/access`,{headers:{cookie}})).json());const downloaded=await restored.fetch(access.url!,{headers:{cookie}});expect(downloaded.status).toBe(200);expect(await bytesHash(new Uint8Array(await downloaded.arrayBuffer()))).toBe(checksum);
    const media=join(output,'media');const files=new Map<string,{path:string;bytes:number;mime:string}>();for(const a of bundle.manifest.assets){const extension=a.mime==='image/png'?'png':'wav';const path=join(await assetDirectory(media,ctx.project,a.id),`source.${extension}`);expect((await fileHash(path)).checksum).toBe(a.checksum);files.set(a.checksum,{path,bytes:a.bytes,mime:a.mime});}
    const task=renderAssignmentSchema.parse({renderId:bundle.render.id,outputAssetId:bundle.render.outputAssetId,manifestHash:bundle.render.manifestHash,manifest:bundle.manifest});const repeated=await localRender(media,task,crypto.randomUUID(),files,{bundle:ctx.composition,development:true});expect(repeated.metadata.checksum).toBe(bundle.render.checksum);expect(JSON.parse(await readFile(join(output,'RESTORE_COMPLETE.json'),'utf8'))).toHaveProperty('files',manifest.files.length);
  }finally{await restored.dispose();}
}});},300000);
