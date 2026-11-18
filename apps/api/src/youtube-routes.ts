import type { Hono } from 'hono';
import { uuidSchema, youtubeViewSchema, youtubePackageSchema, youtubeExportSchema } from '@video-studio/contracts';
import type { ApiEnv } from './app.js';
import { endpoint } from './orchestration.js';
import { authContext } from './auth/routes.js';
import { YoutubeRepository } from './db/youtube.js';
export function registerYoutube(app:Hono<ApiEnv>){
  app.get('/api/v1/projects/:id/renders/:render/youtube',endpoint(async(c)=>c.json(youtubeViewSchema.parse(await new YoutubeRepository(authContext(c)!.db).view(c.get('user')!.id,uuidSchema.parse(c.req.param('id')),uuidSchema.parse(c.req.param('render')),c.req.query('cursor'))))));
  app.post('/api/v1/projects/:id/renders/:render/youtube',endpoint(async(c)=>c.json(youtubePackageSchema.parse(await new YoutubeRepository(authContext(c)!.db).save(c.get('user')!.id,uuidSchema.parse(c.req.param('id')),uuidSchema.parse(c.req.param('render')),uuidSchema.parse(c.req.header('idempotency-key')),await c.req.json<unknown>().catch(()=>null))),201)));
  app.get('/api/v1/projects/:id/exports/:package',endpoint(async(c)=>c.json(youtubeExportSchema.parse(await new YoutubeRepository(authContext(c)!.db).get(c.get('user')!.id,uuidSchema.parse(c.req.param('id')),uuidSchema.parse(c.req.param('package')))))));
  app.get('/api/v1/agents/projects/:id/exports/:package',endpoint(async(c)=>c.json(youtubeExportSchema.parse(await new YoutubeRepository(authContext(c)!.db).get(c.get('agent')!.ownerId,uuidSchema.parse(c.req.param('id')),uuidSchema.parse(c.req.param('package')))))));
}
