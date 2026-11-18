import { createHash, randomUUID } from 'node:crypto';
import { pngFixture, wavFixture } from '../../tests/support/media.ts';
export async function seedRender(db, bucket, project = '00000000-0000-4000-8000-00000000a520') { const owner = '00000000-0000-4000-8000-00000000a500'; const script = randomUUID(); const scene = randomUUID(); const version = randomUUID(); const image = randomUUID(); const voice = randomUUID(); const now = new Date().toISOString(); const narration = 'Narración de prueba.';
  const hash = (v) => createHash('sha256').update(typeof v === 'string' ? v : v).digest('hex');
  const scriptData = { metadata: { schemaVersion: 1, promptVersion: 'fixture-v1', model: 'fixture', simulated: true, language: 'es' }, title: 'Render de prueba', hook: 'Apertura', sections: [{ stableKey: 'render-scene', title: 'Escena', narration, claimIds: [], targetDurationMs: 10000 }], closing: 'Cierre', approximateWords: 3, riskNotes: [] };
  await db.batch([
    db.prepare("INSERT INTO projects (id,owner_id,title,input_type,input_text,mode,status,revision,created_at,updated_at,wizard_step) VALUES (?,?,?,'SCRIPT',?,'SUPERVISED','RUNNING',1,?,?,5)").bind(project,owner,'Render sintético E2E',narration,now,now),
    db.prepare("INSERT INTO project_settings (project_id,language,audience,objective,target_duration_ms,style,modality,checkpoint_policy_json,provider_policy_json,budget_currency,max_cost_micros) VALUES (?,'es','Pruebas','YOUTUBE_LONG',10000,'DOCUMENTARY','DYNAMIC_IMAGES','[]',?,'USD',0)").bind(project,JSON.stringify({ preferredIds: [], allowPaidFallback: false })),
    db.prepare("INSERT INTO script_versions (id,project_id,version_no,script_json,content_hash,target_duration_ms,status,created_at) VALUES (?,?,1,?,?,10000,'APPROVED',?)").bind(script,project,JSON.stringify(scriptData),hash(JSON.stringify(scriptData)),now),
    db.prepare('UPDATE projects SET active_script_version_id=? WHERE id=?').bind(script,project),
  ]);
  for (const [id, mime, bytes, type, duration] of [[image,'image/png',pngFixture(),'IMAGE',null],[voice,'audio/wav',wavFixture(10000),'AUDIO',10000]]) {
    const key = `users/${owner}/projects/${project}/assets/${id}/${hash(bytes)}.${type === 'IMAGE' ? 'png' : 'wav'}`; await bucket.put(key,bytes,{ httpMetadata: { contentType: mime } });
    await db.prepare("INSERT INTO assets (id,project_id,owner_id,type,mime,bytes,checksum,duration_ms,width,height,origin,license_json,prompt,r2_key,availability,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'MANUAL',?,NULL,?,'REMOTE_AVAILABLE',?)").bind(id,project,owner,type,mime,bytes.length,hash(bytes),duration,type === 'IMAGE' ? 2 : null,type === 'IMAGE' ? 2 : null,JSON.stringify({ source: 'Fixture propio; tono sin voz hablada', rightsAcknowledged: true }),key,now).run();
  }
  await db.batch([
    db.prepare("INSERT INTO scenes (id,project_id,stable_key,order_index,revision) VALUES (?,?,'render-scene',0,1)").bind(scene,project),
    db.prepare("INSERT INTO scene_versions (id,project_id,scene_id,script_version_id,version_no,narration,direction_json,duration_ms,generation_scope,status,hash,created_at) VALUES (?,?,?,?,1,?,'{}',10000,'ALL','DRAFT',?,?)").bind(version,project,scene,script,narration,hash(narration),now),
    ...[0,1].map((i) => db.prepare("INSERT INTO shots VALUES (?,?,?,?,?,'IMAGE',?,'{}',?,?)").bind(randomUUID(),project,version,i,5000,'Imagen sintética',JSON.stringify({ type: i ? 'DISSOLVE' : 'CUT' }),image)),
    db.prepare("INSERT INTO asset_links VALUES (?,?,?,?,'VOICE',0,0,10000)").bind(randomUUID(),project,version,voice),
    db.prepare('INSERT INTO voice_segments VALUES (?,?,?,?,0,?,0,10000,?)').bind(randomUUID(),project,version,voice,narration,JSON.stringify({ method: 'MANUAL', version: 1 })),
    db.prepare("UPDATE scene_versions SET status='CANDIDATE' WHERE id=?").bind(version), db.prepare("UPDATE scene_versions SET status='APPROVED' WHERE id=?").bind(version), db.prepare('UPDATE scenes SET active_version_id=? WHERE id=?').bind(version,scene),
    db.prepare('INSERT INTO direction_expansions VALUES (?,?)').bind(script,now),
  ]);
}
