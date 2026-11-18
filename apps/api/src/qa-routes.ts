import type { Hono } from 'hono';
import { qaReportSchema, qaViewSchema, qaRepairResultSchema, uuidSchema } from '@video-studio/contracts';
import type { ApiEnv } from './app.js';
import { endpoint } from './orchestration.js';
import { authContext } from './auth/routes.js';
import { QaRepository } from './db/qa.js';
export function registerQa(app:Hono<ApiEnv>){
  app.get('/api/v1/projects/:id/qa',endpoint(async(c)=>c.json(qaViewSchema.parse(await new QaRepository(authContext(c)!.db).list(c.get('user')!.id,uuidSchema.parse(c.req.param('id')),c.req.query('cursor'))))));
  app.post('/api/v1/projects/:id/qa/run',endpoint(async(c)=>c.json(qaReportSchema.parse(await new QaRepository(authContext(c)!.db).run(c.get('user')!.id,uuidSchema.parse(c.req.param('id')),uuidSchema.parse(c.req.header('idempotency-key')),await c.req.json<unknown>().catch(()=>null))))));
  for(const action of ['approve','repair'] as const)app.post(`/api/v1/projects/:id/qa/:report/${action}`,endpoint(async(c)=>{const repo=new QaRepository(authContext(c)!.db);const args=[c.get('user')!.id,uuidSchema.parse(c.req.param('id')),uuidSchema.parse(c.req.param('report')),uuidSchema.parse(c.req.header('idempotency-key')),await c.req.json<unknown>().catch(()=>null)] as const;return c.json(action==='approve'?qaReportSchema.parse(await repo.approve(...args)):qaRepairResultSchema.parse(await repo.repair(...args)));}));
}
