import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { agentClaimResponseSchema, agentClaimSchema, agentDtoSchema, agentHeartbeatSchema, agentJobCompleteSchema, agentJobFailSchema, agentJobHeartbeatSchema, agentListSchema, agentTokenSchema, assetSchema, importInspectionSchema, jobDtoSchema, localAssetRegisterSchema, pairingDtoSchema, pendingInspectionsSchema, revisionInputSchema, uuidSchema, importDtoSchema } from '@video-studio/contracts';
import type { ApiEnv } from './app.js';
import { errorBody } from './app.js';
import { authContext, requestAllowed } from './auth/routes.js';
import { requirePrivateAccess } from './private-access.js';
import { endpoint } from './orchestration.js';
import { AgentRepository } from './db/agents.js';
import { JobConflict, JobNotFound, JobRepository, batchChanges } from './db/jobs.js';
import { JobRunnerRepository } from './db/job-runner.js';
import { MediaRepository } from './db/media.js';
import { CatalogRepository, catalogHash } from './db/catalog.js';

const repository = (c: Context<ApiEnv>) => new AgentRepository(authContext(c)!.db, authContext(c)!.config.secret);
const operation = (c: Context<ApiEnv>) => uuidSchema.parse(c.req.header('idempotency-key'));
const body = (c: Context<ApiEnv>) => c.req.json<unknown>().catch(() => null);
export async function commandResult<T>(c: Context<ApiEnv>, action: string, input: unknown, schema: z.ZodType<T>, perform: () => Promise<T>) {
  const repo = repository(c); const agent = c.get('agent')!; const key = operation(c); const request = { id: c.req.param('id'), input }; const previous = await repo.command(agent.id, key, action, request);
  if (previous.response) return schema.parse(previous.response); const result = schema.parse(await perform());
  await repo.db.prepare('UPDATE agent_commands SET response_json=? WHERE agent_id=? AND operation_id=? AND response_json IS NULL').bind(JSON.stringify(result), agent.id, key).run();
  return schema.parse((await repo.command(agent.id, key, action, request)).response);
}
async function requireAgent(c: Context<ApiEnv>, next: () => Promise<void>) {
  if (!authContext(c)) return c.json(errorBody(c.get('requestId'), 'SERVICE_UNAVAILABLE', 'Acceso sin configurar.', false), 503);
  const agent = await repository(c).authenticate(c.req.header('authorization')?.replace(/^Bearer /, '') ?? '');
  if (!agent) return c.json(errorBody(c.get('requestId'), 'UNAUTHENTICATED', 'Agente no autorizado o revocado.', false), 401);
  if (c.req.method !== 'GET') { if (c.req.header('content-type')?.split(';')[0] !== 'application/json') return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Se requiere JSON.', false), 400); if (!await requestAllowed(authContext(c)!.db, `agent:${agent.id}`, 240, 60000)) return c.json(errorBody(c.get('requestId'), 'RATE_LIMITED', 'Espera antes de volver a intentarlo.', true), 429); }
  c.set('agent', agent); await next();
}
export async function ownedLease(c: Context<ApiEnv>, id: string, token: string, completed = false) {
  const agent = c.get('agent')!; const db = authContext(c)!.db;
  const row = await db.prepare(`SELECT j.id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=? AND p.owner_id=? AND (j.agent_id=? OR (?=1 AND EXISTS(SELECT 1 FROM agent_commands cmd WHERE cmd.agent_id=? AND json_extract(cmd.response_json,'$.lease.job.id')=j.id AND json_extract(cmd.response_json,'$.lease.leaseToken')=?))) AND EXISTS(SELECT 1 FROM job_attempts a WHERE a.job_id=j.id AND a.lease_token=?)`).bind(id, agent.ownerId, agent.id, completed ? 1 : 0, agent.id, token, token).first();
  if (!row) throw new JobNotFound();
}
export function registerAgents(app: Hono<ApiEnv>) {
  app.get('/api/v1/agents', requirePrivateAccess, endpoint(async (c) => c.json(agentListSchema.parse({ items: await repository(c).list(c.get('user')!.id) }))));
  app.post('/api/v1/agents/pairing', requirePrivateAccess, endpoint(async (c) => c.json(pairingDtoSchema.parse(await repository(c).pairing(c.get('user')!.id, operation(c), await body(c))), 201)));
  app.post('/api/v1/agents/:id/revoke', requirePrivateAccess, endpoint(async (c) => c.json(agentDtoSchema.parse(await repository(c).revoke(c.get('user')!.id, uuidSchema.parse(c.req.param('id')), operation(c), revisionInputSchema.parse(await body(c)).expectedRevision)))));
  app.post('/api/v1/agents/pair', endpoint(async (c) => {
    const context = authContext(c); if (!context) return c.json(errorBody(c.get('requestId'), 'SERVICE_UNAVAILABLE', 'Acceso sin configurar.', false), 503);
    if (!await requestAllowed(context.db, 'agent-pair:loopback', 10, 60000)) return c.json(errorBody(c.get('requestId'), 'RATE_LIMITED', 'Espera antes de volver a intentarlo.', true), 429);
    if (c.req.header('content-type')?.split(';')[0] !== 'application/json') return c.json(errorBody(c.get('requestId'), 'INVALID_INPUT', 'Se requiere JSON.', false), 400);
    return c.json(agentTokenSchema.parse(await repository(c).pair(operation(c), await body(c))));
  }));
  for (const path of ['/heartbeat', '/projects/*', '/jobs/*', '/assets/*', '/imports', '/imports/*']) app.use(`/api/v1/agents${path}`, requireAgent);
  app.post('/api/v1/agents/heartbeat', endpoint(async (c) => c.json(agentDtoSchema.parse(await repository(c).heartbeat(c.get('agent')!, operation(c), agentHeartbeatSchema.parse(await body(c)))))));
  app.post('/api/v1/agents/jobs/claim', endpoint(async (c) => {
    const input = agentClaimSchema.parse(await body(c)); const agent = c.get('agent')!; const repo = repository(c); const key = operation(c); const cmd = await repo.command(agent.id, key, 'CLAIM', input); if (cmd.response) return c.json(agentClaimResponseSchema.parse(cmd.response));
    const record = repo.dto(await repo.get(agent.ownerId, agent.id)); const kinds = ['VALIDATE_INPUT', ...(record.capabilities.render && record.capabilities.ffprobe ? ['RENDER'] : [])]; const db = repo.db; const runner = new JobRunnerRepository(db);
    const expired = await db.prepare("SELECT j.project_id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE p.owner_id=? AND j.agent_id=? AND j.status='RUNNING' AND j.lease_until<=? LIMIT 1").bind(agent.ownerId, agent.id, repo.now()).first<{ project_id: string }>(); if (expired) await runner.recoverExpired(agent.ownerId, expired.project_id, 1);
    if (kinds.includes('RENDER')) await db.prepare("UPDATE jobs SET status='PENDING',revision=revision+1 WHERE execution_target='LOCAL' AND kind='RENDER' AND status='WAITING_RESOURCE' AND attempt_count=0 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=jobs.project_id AND p.owner_id=? AND p.pause_requested=0 AND p.archived_at IS NULL)").bind(agent.ownerId).run();
    const project = await db.prepare(`SELECT j.project_id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE p.owner_id=? AND p.archived_at IS NULL AND p.pause_requested=0 AND j.execution_target='LOCAL' AND j.status IN('PENDING','READY','RETRY_SCHEDULED') AND j.kind IN(${kinds.map((k) => `'${k}'`).join(',')}) ORDER BY j.created_at,j.id LIMIT 1`).bind(agent.ownerId).first<{ project_id: string }>();
    if (project) await runner.claim(agent.ownerId, project.project_id, agent.id, 'LOCAL', 90000, false, { operation: key, hash: cmd.hash, kinds });
    await db.prepare("UPDATE agent_commands SET response_json='{\"lease\":null}' WHERE agent_id=? AND operation_id=? AND response_json IS NULL").bind(agent.id, key).run();
    const result = await repo.command(agent.id, key, 'CLAIM', input); return c.json(agentClaimResponseSchema.parse(result.response));
  }));
  app.post('/api/v1/agents/jobs/:id/heartbeat', endpoint(async (c) => { const input = agentJobHeartbeatSchema.parse(await body(c)); const id = uuidSchema.parse(c.req.param('id')); return c.json(await commandResult(c, 'JOB_HEARTBEAT', input, z.object({ pauseRequested: z.boolean() }), async () => { await ownedLease(c, id, input.leaseToken); return new JobRunnerRepository(authContext(c)!.db).heartbeat(c.get('agent')!.ownerId, id, input.leaseToken, input.progress); })); }));
  app.post('/api/v1/agents/jobs/:id/complete', endpoint(async (c) => { const input = agentJobCompleteSchema.parse(await body(c)); const id = uuidSchema.parse(c.req.param('id')); return c.json(await commandResult(c, 'JOB_COMPLETE', input, jobDtoSchema, async () => { await ownedLease(c, id, input.leaseToken, true); const runner = new JobRunnerRepository(authContext(c)!.db); if ((await runner.jobs.get(c.get('agent')!.ownerId, id))?.kind !== 'VALIDATE_INPUT') throw new JobConflict(); return runner.complete(c.get('agent')!.ownerId, id, input.leaseToken, input.output); })); }));
  app.post('/api/v1/agents/jobs/:id/fail', endpoint(async (c) => { const input = agentJobFailSchema.parse(await body(c)); const id = uuidSchema.parse(c.req.param('id')); return c.json(await commandResult(c, 'JOB_FAIL', input, jobDtoSchema, async () => { await ownedLease(c, id, input.leaseToken, true); const db = authContext(c)!.db; const runner = new JobRunnerRepository(db); const previous = await db.prepare("SELECT status FROM job_attempts WHERE job_id=? AND lease_token=? AND status IN('FAILED','UNKNOWN')").bind(id, input.leaseToken).first(); if (previous) return (await runner.jobs.get(c.get('agent')!.ownerId, id))!; return runner.fail(c.get('agent')!.ownerId, id, input.leaseToken, input.code); })); }));
  app.get('/api/v1/agents/imports', endpoint(async (c) => {
    const rows = await authContext(c)!.db.prepare("SELECT i.* FROM asset_imports i JOIN projects p ON p.id=i.project_id WHERE i.owner_id=? AND p.archived_at IS NULL AND i.state='UPLOADED' AND i.inspection_json IS NULL AND i.inspection_error IS NULL ORDER BY i.created_at,i.id LIMIT 1").bind(c.get('agent')!.ownerId).all<{ id: string; request_json: string; state: string; created_at: string }>();
    return c.json(pendingInspectionsSchema.parse({ items: rows.results.map((r) => importDtoSchema.parse({ ...JSON.parse(r.request_json) as object, id: r.id, state: r.state, requiresInspection: true, createdAt: r.created_at })) }));
  }));
  app.get('/api/v1/agents/imports/:id/content', endpoint(async (c) => { const row = await new MediaRepository(authContext(c)!.db, c.env.MEDIA!).owned(c.get('agent')!.ownerId, uuidSchema.parse(c.req.param('id'))); if (row.state !== 'UPLOADED' || row.inspection_json) throw new JobConflict(); const object = await c.env.MEDIA!.get(row.object_key); if (!object) throw new JobNotFound(); c.set('binaryResponse', true); return new Response(object.body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } }); }));
  app.post('/api/v1/agents/imports/:id/inspect', endpoint(async (c) => {
    const input = importInspectionSchema.parse(await body(c)); return c.json(await commandResult(c, 'IMPORT_INSPECT', input, assetSchema, async () => { const agent = c.get('agent')!; const db = authContext(c)!.db; const media = new MediaRepository(db, c.env.MEDIA!); const id = uuidSchema.parse(c.req.param('id')); const row = await media.owned(agent.ownerId, id); const declared = importDtoSchema.parse({ ...JSON.parse(row.request_json) as object, id, state: row.state, requiresInspection: true, createdAt: row.created_at });
    if (declared.mime !== input.metadata.mime || declared.checksum !== input.metadata.checksum || declared.bytes !== input.metadata.bytes || !repository(c).dto(await repository(c).get(agent.ownerId, agent.id)).capabilities.ffprobe) throw new JobConflict();
    if (row.state !== 'VERIFIED') await db.prepare("UPDATE asset_imports SET inspection_json=? WHERE id=? AND owner_id=? AND state='UPLOADED' AND EXISTS(SELECT 1 FROM local_agents a WHERE a.id=? AND a.revoked_at IS NULL)").bind(JSON.stringify(input.metadata), id, agent.ownerId, agent.id).run();
    return assetSchema.parse(await media.finalize(agent.ownerId, id, operation(c))); }));
  }));
  app.post('/api/v1/agents/imports/:id/fail', endpoint(async (c) => { const input = z.strictObject({ code: z.literal('INVALID_MEDIA') }).parse(await body(c)); return c.json(await commandResult(c, 'IMPORT_FAIL', input, z.object({ ok: z.literal(true) }), async () => { const id = uuidSchema.parse(c.req.param('id')); await new MediaRepository(authContext(c)!.db, c.env.MEDIA!).owned(c.get('agent')!.ownerId, id); await authContext(c)!.db.prepare("UPDATE asset_imports SET inspection_error='INVALID_MEDIA' WHERE id=? AND owner_id=? AND state='UPLOADED' AND inspection_json IS NULL").bind(id, c.get('agent')!.ownerId).run(); return { ok: true as const }; })); }));
  app.post('/api/v1/agents/assets/register', endpoint(async (c) => {
    const input = localAssetRegisterSchema.parse(await body(c)); const agent = c.get('agent')!; const db = authContext(c)!.db; const jobs = new JobRepository(db); await jobs.project(agent.ownerId, input.projectId);
    const hash = await catalogHash({ action: 'REGISTER_LOCAL_ASSET', input }); const key = operation(c); const replay = await jobs.receipt(agent.ownerId, input.projectId, key, hash); if (replay) return c.json(assetSchema.parse(replay));
    if (input.asset.origin !== 'MANUAL' || input.asset.license.rightsAcknowledged !== true || !input.asset.license.source) throw new JobConflict(); const now = jobs.timestamp(); const asset = assetSchema.parse({ ...input.asset, id: input.assetId, projectId: input.projectId, availability: 'LOCAL_ONLY', createdAt: now });
    const gate = 'EXISTS(SELECT 1 FROM projects p JOIN local_agents a ON a.owner_id=p.owner_id WHERE p.id=? AND p.owner_id=? AND p.archived_at IS NULL AND a.id=? AND a.revoked_at IS NULL)';
    try { if (batchChanges(await db.batch([
      db.prepare(`INSERT INTO assets (id,project_id,owner_id,type,mime,bytes,checksum,duration_ms,width,height,origin,license_json,prompt,availability,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gate}`).bind(asset.id, asset.projectId, agent.ownerId, asset.type, asset.mime, asset.bytes, asset.checksum, asset.durationMs, asset.width, asset.height, asset.origin, JSON.stringify(asset.license), asset.prompt, asset.availability, asset.createdAt, input.projectId, agent.ownerId, agent.id),
      db.prepare('INSERT INTO asset_locations SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM assets WHERE id=?)').bind(asset.id, asset.projectId, agent.ownerId, agent.id, now, asset.id),
      db.prepare('INSERT INTO job_commands SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM assets WHERE id=?)').bind(asset.projectId, key, hash, JSON.stringify(asset), asset.id),
    ])) !== 1) throw new JobConflict(); } catch (error) { const prior = await jobs.receipt(agent.ownerId, input.projectId, key, hash); if (prior) return c.json(assetSchema.parse(prior)); throw error; }
    return c.json((await new CatalogRepository(db).getAsset(agent.ownerId, input.projectId, asset.id))!, 201);
  }));
}
