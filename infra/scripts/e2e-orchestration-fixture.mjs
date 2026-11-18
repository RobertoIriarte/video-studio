import { randomUUID } from 'node:crypto';
import { betterAuth } from '../../apps/api/src/auth/runtime.mjs';

// Solo lo importa e2e-server: base efímera, identidades sintéticas y ningún proveedor.
export async function seedOrchestration(db, origin, secret, password) {
  const owner = '00000000-0000-4000-8000-00000000a300';
  const project = '00000000-0000-4000-8000-00000000a301';
  const provider = '00000000-0000-4000-8000-00000000a302';
  const auth = betterAuth({ database: db, baseURL: origin, basePath: '/api/v1/auth', secret,
    emailAndPassword: { enabled: true, autoSignIn: false, minPasswordLength: 12 }, advanced: { database: { generateId: ({ model }) => model === 'user' ? owner : randomUUID() } },
    telemetry: { enabled: false }, logger: { disabled: true } });
  await auth.api.signUpEmail({ body: { name: 'Operador de simulación', email: 'production-e2e@example.invalid', password } });
  const nowMs = Date.now(); const now = new Date(nowMs).toISOString();
  const caps = { operations: ['STRUCTURED_TEXT'], aspectRatios: ['16:9'], languages: ['es'], maxDurationMs: null, maxBytes: null, polling: true, cancellation: false, idempotency: true };
  const limits = { concurrency: 1, quotaUnits: 100, windowMs: 60000, maxCostPerJobMicros: 0 };
  await db.batch([
    db.prepare("INSERT INTO projects (id,owner_id,title,input_type,input_text,mode,status,revision,created_at,updated_at,wizard_step) VALUES (?,?,?,'TOPIC',?,'SUPERVISED','FAILED',1,?,?,5)")
      .bind(project, owner, 'Producción de prueba · simulación', 'Contenido sintético para E2E.', now, now),
    db.prepare(`INSERT INTO project_settings (project_id,language,audience,objective,target_duration_ms,style,modality,checkpoint_policy_json,provider_policy_json,budget_currency,max_cost_micros)
      VALUES (?,'es','Público de prueba','YOUTUBE_LONG',600000,'DOCUMENTARY','DYNAMIC_IMAGES',?,?,'USD',0)`)
      .bind(project, JSON.stringify(['SCRIPT', 'DIRECTION']), JSON.stringify({ allowPaidFallback: false, preferredIds: [] })),
    db.prepare(`INSERT INTO provider_configs (id,owner_id,name,kind,adapter_key,integration_mode,enabled,priority,caps_json,limits_json,pricing_json,status,revision,updated_at)
      VALUES (?,?,?,'TEXT','MOCK_FIXTURE','MOCK',1,10,?,?,?,'AVAILABLE',1,?)`)
      .bind(provider, owner, 'Fixture de texto · simulación', JSON.stringify(caps), JSON.stringify(limits), JSON.stringify({ currency: 'USD', costPerUnitMicros: 0 }), now),
  ]);
  const scripts = [randomUUID(), randomUUID()];
  for (let version = 1; version <= 2; version++) await db.prepare(`INSERT INTO script_versions (id,project_id,research_version_id,version_no,script_json,content_hash,target_duration_ms,status,created_at)
    VALUES (?,?,NULL,?,?,?,600000,'CANDIDATE',?)`).bind(scripts[version - 1], project, version,
      JSON.stringify({ schemaVersion: 1, title: `Guion sintético ${version}`, paragraphs: [`Contenido de revisión de la versión ${version}. Sin generación real.`] }), String(version).repeat(64), now).run();
  for (let i = 0; i < 26; i++) {
    const id = randomUUID(); const createdAt = new Date(nowMs - (26 - i) * 1000).toISOString();
    const status = i < 2 ? 'WAITING_APPROVAL' : i === 2 ? 'FAILED' : i === 3 ? 'WAITING_RESOURCE' : i % 3 === 0 ? 'RETRY_SCHEDULED' : i % 3 === 1 ? 'WAITING_MANUAL' : 'SUCCEEDED';
    const kind = i < 2 ? 'SCRIPT' : 'VALIDATE_INPUT'; const attempt = status === 'WAITING_MANUAL' ? 0 : 1;
    const code = i === 2 ? 'AUTH_REQUIRED' : i === 3 ? 'UNKNOWN_OUTCOME' : status === 'RETRY_SCHEDULED' ? 'RATE_LIMIT' : null;
    const error = code ? { code, message: i === 3 ? 'Resultado de fixture incierto; no reintentar automáticamente.' : 'Fallo sintético para probar recuperación.', retryable: code === 'RATE_LIMIT' } : null;
    const output = i < 2 ? { kind: 'SCRIPT', id: scripts[i], hash: String(i + 1).repeat(64) } : null;
    await db.prepare(`INSERT INTO jobs (id,project_id,kind,execution_target,status,payload_json,input_refs_json,output_ref,idempotency_key,input_hash,attempt_count,max_attempts,next_run_at,progress_json,error_json,revision,created_at,updated_at,selected_provider_id)
      VALUES (?,?,?,'CLOUD',?,'{}','[]',?,?,?,?,3,?,?,?,1,?,?,?)`).bind(id, project, kind, status, output ? JSON.stringify(output) : null, randomUUID(), 'a'.repeat(64), attempt,
        status === 'RETRY_SCHEDULED' ? new Date(nowMs + 60000).toISOString() : null,
        JSON.stringify({ message: 'Estado sintético persistido; sin producción real.', ...(status === 'SUCCEEDED' ? { completed: 1, total: 1 } : {}) }), error ? JSON.stringify(error) : null, createdAt, now, provider).run();
    if (attempt) await db.prepare(`INSERT INTO job_attempts (id,job_id,attempt_no,request_id,lease_token,start_at,end_at,status,error_code,provider_id,external_started)
      VALUES (?,?,1,?,?,?,?,?,?,?,?)`).bind(randomUUID(), id, randomUUID(), randomUUID(), createdAt, now,
        i === 3 ? 'UNKNOWN' : code ? 'FAILED' : 'SUCCEEDED', code, provider, i === 3 ? 1 : 0).run();
    if (i < 2) await db.prepare(`INSERT INTO checkpoints (id,project_id,job_id,stage,subject_version_id,script_version_id,blocking,status,revision)
      VALUES (?,?,?,'SCRIPT',?,?,0,'PENDING',1)`).bind(randomUUID(), project, id, scripts[i], scripts[i]).run();
    await db.prepare("INSERT INTO activity_events VALUES (?,?,?,?,'SYSTEM',NULL,'JOB_CREATED','{}',?)").bind(randomUUID(), owner, project, id, createdAt).run();
  }
}
