import { createHash, randomUUID } from 'node:crypto';
// Isolated synthetic scene for voice UI; never loaded by production code.
export async function seedVoice(db) {
  const owner = '00000000-0000-4000-8000-00000000a500'; const project = '00000000-0000-4000-8000-00000000a510'; const scene = '00000000-0000-4000-8000-00000000a512'; const script = randomUUID(); const version = randomUUID(); const now = new Date().toISOString();
  const hash = createHash('sha256').update('voice-fixture').digest('hex'); const narration = 'Primera frase. Segunda frase.';
  const data = { metadata: { schemaVersion: 1, promptVersion: 'fixture-v1', model: 'fixture', simulated: true, language: 'es' }, title: 'Voz de prueba', hook: 'Apertura', sections: [{ stableKey: 'voice-scene', title: 'Escena', narration, claimIds: [], targetDurationMs: 60000 }], closing: 'Cierre', approximateWords: 4, riskNotes: [] };
  await db.batch([
    db.prepare("INSERT INTO projects (id,owner_id,title,input_type,input_text,mode,status,revision,created_at,updated_at,wizard_step) VALUES (?,?,?,'SCRIPT',?,'SUPERVISED','RUNNING',1,?,?,5)").bind(project, owner, 'Voz sintética E2E', narration, now, now),
    db.prepare("INSERT INTO project_settings (project_id,language,audience,objective,target_duration_ms,style,modality,checkpoint_policy_json,provider_policy_json,budget_currency,max_cost_micros) VALUES (?,'es','Pruebas','YOUTUBE_LONG',60000,'DOCUMENTARY','DYNAMIC_IMAGES',?,?,'USD',0)").bind(project, JSON.stringify(['SCRIPT', 'DIRECTION']), JSON.stringify({ allowPaidFallback: false, preferredIds: [] })),
    db.prepare("INSERT INTO script_versions (id,project_id,version_no,script_json,content_hash,target_duration_ms,status,created_at) VALUES (?,?,1,?,?,60000,'APPROVED',?)").bind(script, project, JSON.stringify(data), hash, now),
    db.prepare('UPDATE projects SET active_script_version_id=? WHERE id=?').bind(script, project),
    db.prepare("INSERT INTO scenes (id,project_id,stable_key,order_index,revision) VALUES (?,?,'voice-scene',0,1)").bind(scene, project),
    db.prepare("INSERT INTO scene_versions (id,project_id,scene_id,script_version_id,version_no,narration,direction_json,duration_ms,generation_scope,status,hash,created_at) VALUES (?,?,?,?,1,?,'{}',60000,'ALL','DRAFT',?,?)").bind(version, project, scene, script, narration, hash, now),
    db.prepare("INSERT INTO shots VALUES (?,?,?,?,?,'IMAGE',?,'{}','{}',NULL)").bind(randomUUID(), project, version, 0, 60000, 'Imagen de prueba'),
    db.prepare("UPDATE scene_versions SET status='CANDIDATE' WHERE id=?").bind(version), db.prepare("UPDATE scene_versions SET status='APPROVED' WHERE id=?").bind(version), db.prepare('UPDATE scenes SET active_version_id=? WHERE id=?').bind(version, scene),
    db.prepare('INSERT INTO direction_expansions VALUES (?,?)').bind(script, now),
  ]);
}
