import type { Hono } from 'hono';
import { contentMutationSchema, manifestViewSchema, uuidSchema, jobDtoSchema, renderAssignmentSchema, renderCompleteSchema, renderListSchema, renderQaFailureSchema } from '@video-studio/contracts';
import type { ApiEnv } from './app.js';
import { authContext } from './auth/routes.js';
import { endpoint } from './orchestration.js';
import { ManifestRepository } from './db/manifests.js';
import { RenderRepository } from './db/renders.js';
import { ownedLease, commandResult } from './agent-routes.js';
import { JobConflict, JobNotFound, currentInputsSql } from './db/jobs.js';
import { MediaRepository } from './db/media.js';
import { JobRunnerRepository } from './db/job-runner.js';
export function registerRender(app: Hono<ApiEnv>) {
  app.get('/api/v1/projects/:id/renders', endpoint(async (c) => c.json(renderListSchema.parse(await new RenderRepository(authContext(c)!.db).list(c.get('user')!.id,uuidSchema.parse(c.req.param('id')),c.req.query('cursor'))))));
  app.post('/api/v1/projects/:id/render', endpoint(async (c) => c.json(jobDtoSchema.parse(await new RenderRepository(authContext(c)!.db).start(c.get('user')!.id,uuidSchema.parse(c.req.param('id')),uuidSchema.parse(c.req.header('idempotency-key')),await c.req.json<unknown>().catch(() => null))),202)));
  for (const suffix of ['/render-input','/render-assets/:asset']) app.get(`/api/v1/agents/jobs/:id${suffix}`,endpoint(async (c) => {
    const id = uuidSchema.parse(c.req.param('id')); const token = uuidSchema.parse(c.req.query('leaseToken')); await ownedLease(c,id,token); const agent = c.get('agent')!; const db = authContext(c)!.db;
    const live = await db.prepare(`SELECT id FROM jobs j WHERE id=? AND agent_id=? AND status='RUNNING' AND lease_token=? AND lease_until>? AND ${currentInputsSql('j')}`).bind(id,agent.id,token,new Date().toISOString()).first(); if (!live) throw new JobConflict();
    const task = await new RenderRepository(db).assignment(agent.ownerId,id); if (suffix === '/render-input') return c.json(renderAssignmentSchema.parse(task));
    const asset = uuidSchema.parse(c.req.param('asset')); if (!task.manifest.assets.some((a) => a.id === asset)) throw new JobNotFound(); const stored = await new MediaRepository(db,c.env.MEDIA!).asset(agent.ownerId,asset); if (!stored.key) throw new JobNotFound(); const object = await c.env.MEDIA!.get(stored.key); if (!object) throw new JobNotFound(); c.set('binaryResponse',true); return new Response(object.body,{headers:{'content-type':'application/octet-stream','cache-control':'no-store'}});
  }));
  app.post('/api/v1/agents/jobs/:id/render-qa-fail',endpoint(async(c)=>{const input=renderQaFailureSchema.parse(await c.req.json<unknown>());const id=uuidSchema.parse(c.req.param('id'));return c.json(await commandResult(c,'RENDER_QA_FAIL',input,jobDtoSchema,async()=>{await ownedLease(c,id,input.leaseToken);return new RenderRepository(authContext(c)!.db).failQa(c.get('agent')!.ownerId,id,input,c.get('agent')!.id,uuidSchema.parse(c.req.header('idempotency-key')));}));}));
  app.post('/api/v1/agents/jobs/:id/render-complete',endpoint(async (c) => { const input = renderCompleteSchema.parse(await c.req.json<unknown>().catch(() => null)); const id = uuidSchema.parse(c.req.param('id')); return c.json(await commandResult(c,'RENDER_COMPLETE',input,jobDtoSchema,async () => { await ownedLease(c,id,input.leaseToken,true); return new RenderRepository(authContext(c)!.db).publish(c.get('agent')!.ownerId,c.get('agent')!.id,id,input,uuidSchema.parse(c.req.header('idempotency-key'))); })); }));
  app.post('/api/v1/agents/jobs/:id/pause',endpoint(async (c) => { const input = uuidSchema.parse((await c.req.json<{leaseToken?:unknown}>()).leaseToken); const id=uuidSchema.parse(c.req.param('id')); return c.json(await commandResult(c,'LOCAL_PAUSE',{leaseToken:input},jobDtoSchema,async () => { await ownedLease(c,id,input); return new JobRunnerRepository(authContext(c)!.db).pauseAtSafePoint(c.get('agent')!.ownerId,id,input); })); }));
  app.get('/api/v1/projects/:id/manifests', endpoint(async (c) => c.json(manifestViewSchema.parse(await new ManifestRepository(authContext(c)!.db).list(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), c.req.query('cursor'))))));
  app.post('/api/v1/projects/:id/manifests', endpoint(async (c) => c.json(contentMutationSchema.parse(await new ManifestRepository(authContext(c)!.db).save(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), uuidSchema.parse(c.req.header('idempotency-key')), await c.req.json<unknown>().catch(() => null))), 201)));
  app.post('/api/v1/projects/:id/manifests/:version/activate', endpoint(async (c) => {
    const result = await new ManifestRepository(authContext(c)!.db).activate(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), uuidSchema.parse(c.req.param('version')), uuidSchema.parse(c.req.header('idempotency-key')), await c.req.json<unknown>().catch(() => null));
    return c.json(contentMutationSchema.parse(result));
  }));
}
