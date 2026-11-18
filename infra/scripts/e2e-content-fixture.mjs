import { createHash, randomUUID } from 'node:crypto';
import { betterAuth } from '../../apps/api/src/auth/runtime.mjs';

// Solo servidor E2E, D1 efímero; sin archivos, cuentas reales ni conexiones externas.
export async function seedContent(db, origin, secret, password) {
  const owner = '00000000-0000-4000-8000-00000000a400'; const project = '00000000-0000-4000-8000-00000000a401'; const now = new Date().toISOString();
  const auth = betterAuth({ database: db, baseURL: origin, basePath: '/api/v1/auth', secret, emailAndPassword: { enabled: true, minPasswordLength: 12 }, advanced: { database: { generateId: ({ model }) => model === 'user' ? owner : randomUUID() } }, telemetry: { enabled: false }, logger: { disabled: true } });
  await auth.api.signUpEmail({ body: { name: 'Editor sintético', email: 'content-e2e@example.invalid', password } });
  const research = randomUUID(); const script = randomUUID(); const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const metadata = { schemaVersion: 1, promptVersion: 'fixture-v1', model: 'synthetic', simulated: true, language: 'es' };
  const researchData = { metadata, sources: [{ key: 'own', title: 'Referencia sintética', url: 'https://example.invalid/fuente', acquiredAt: now, notes: 'No consultada.', provenance: 'MANUAL', accessStatus: 'UNKNOWN' }], claims: [], outlineSuggestions: ['Introducción'], uncertainties: ['Fixture sin verificación externa.'] };
  const scriptData = { metadata, title: 'Guion para edición', hook: 'Apertura sintética', sections: Array.from({ length: 26 }, (_, i) => ({ stableKey: `scene-${String(i + 1).padStart(2, '0')}`, title: `Escena ${i + 1}`, narration: `Narración sintética ${i + 1}.`, claimIds: [], targetDurationMs: 60000 })), closing: 'Cierre sintético', approximateWords: 78, riskNotes: [] };
  await db.batch([
    db.prepare("INSERT INTO projects (id,owner_id,title,input_type,input_text,mode,status,revision,created_at,updated_at,wizard_step) VALUES (?,?,?,'SCRIPT',?,'SUPERVISED','RUNNING',1,?,?,5)").bind(project, owner, 'Edición de prueba · simulación', 'Guion sintético para edición.', now, now),
    db.prepare("INSERT INTO project_settings (project_id,language,audience,objective,target_duration_ms,style,modality,checkpoint_policy_json,provider_policy_json,budget_currency,max_cost_micros) VALUES (?,'es','Pruebas','YOUTUBE_LONG',1560000,'DOCUMENTARY','HYBRID',?,?,'USD',0)").bind(project, JSON.stringify(['SCRIPT', 'DIRECTION']), JSON.stringify({ allowPaidFallback: false, preferredIds: [] })),
    db.prepare("INSERT INTO research_versions (id,project_id,version_no,data_json,content_hash,status,created_at) VALUES (?,?,1,?,?,'DRAFT',?)").bind(research, project, JSON.stringify(researchData), hash(researchData), now),
    db.prepare('INSERT INTO sources VALUES (?,?,?,?,?,?,?,?)').bind(randomUUID(), research, researchData.sources[0].url, researchData.sources[0].title, now, 'No consultada.', 'MANUAL', 'UNKNOWN'),
    db.prepare("UPDATE research_versions SET status='CANDIDATE' WHERE id=?").bind(research), db.prepare("UPDATE research_versions SET status='APPROVED' WHERE id=?").bind(research),
    db.prepare("INSERT INTO script_versions (id,project_id,research_version_id,version_no,script_json,content_hash,target_duration_ms,status,created_at) VALUES (?,?,?,1,?,?,1560000,'APPROVED',?)").bind(script, project, research, JSON.stringify(scriptData), hash(scriptData), now),
    db.prepare('UPDATE projects SET active_script_version_id=? WHERE id=?').bind(script, project),
  ]);
  for (const [i, section] of scriptData.sections.entries()) {
    const scene = randomUUID(); const version = randomUUID();
    await db.batch([
      db.prepare('INSERT INTO scenes (id,project_id,stable_key,order_index,revision) VALUES (?,?,?,?,1)').bind(scene, project, section.stableKey, i),
      db.prepare("INSERT INTO scene_versions (id,project_id,scene_id,script_version_id,version_no,narration,direction_json,duration_ms,generation_scope,status,hash,created_at) VALUES (?,?,?,?,1,?,?,60000,'ALL','DRAFT',?,?)").bind(version, project, scene, script, section.narration, JSON.stringify({ continuityNotes: 'Mantener paleta y eje.', musicMood: 'Calma', visualBible: { presetVersion: 1, palette: ['ámbar'], characters: [], locations: [], continuity: 'Mantener estilo.', referenceAssetIds: [] } }), hash(section), now),
      ...Array.from({ length: 3 }, (_, shot) => db.prepare('INSERT INTO shots VALUES (?,?,?,?,?,?,?,?,?,NULL)').bind(randomUUID(), project, version, shot, 20000, shot % 2 ? 'VIDEO' : 'IMAGE', `Prompt sintético ${shot + 1}`, JSON.stringify({ movement: 'Cámara fija' }), JSON.stringify({ type: 'CUT' }))),
      db.prepare("UPDATE scene_versions SET status='CANDIDATE' WHERE id=?").bind(version), db.prepare("UPDATE scene_versions SET status='APPROVED' WHERE id=?").bind(version), db.prepare('UPDATE scenes SET active_version_id=? WHERE id=?').bind(version, scene),
    ]);
  }
  await db.prepare('INSERT INTO direction_expansions VALUES (?,?)').bind(script, now).run();
}
