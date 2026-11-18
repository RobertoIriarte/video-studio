import { createBackup, verifyBackup, restoreBackup } from './backup.js';
import { exportFromAgent } from './export.js';
import { renderReady, locateRender } from './render.js';
import { importLocalFile } from './import.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parseArgs } from 'node:util';
import { AgentApiError, AgentClient } from './client.js';
import { defaultProbePath, probeVersion } from './probe.js';
import { defaultMediaRoot, readConfig, writeConfig } from './config.js';
import type { AgentConfig } from './config.js';
import { diskFree } from './cache.js';
const parsed = parseArgs({ allowPositionals: true, options: { url: { type: 'string' }, name: { type: 'string' }, root: { type: 'string' }, ffprobe: { type: 'string' }, once: { type: 'boolean' }, file: { type: 'string' }, project: { type: 'string' }, mime: { type: 'string' }, source: { type: 'string' }, rights: { type: 'boolean' }, render: { type: 'string' }, package: { type: 'string' }, output: { type: 'string' }, state: { type: 'string' }, backup: { type: 'string' }, quiesced: { type: 'boolean' } } });
async function main() {
  const command = parsed.positionals[0] ?? 'doctor';
  if (['backup','verify-backup','restore'].includes(command)) { let result; if(command==='backup'){if(!parsed.values.state||!parsed.values.root||!parsed.values.output)throw new Error('BACKUP_ARGUMENTS_REQUIRED');result=await createBackup(parsed.values.state,parsed.values.root,parsed.values.output,parsed.values.quiesced===true);}else {if(!parsed.values.backup)throw new Error('BACKUP_ARGUMENTS_REQUIRED');if(command==='restore'){if(!parsed.values.output)throw new Error('BACKUP_ARGUMENTS_REQUIRED');result=await restoreBackup(parsed.values.backup,parsed.values.output);}else result=await verifyBackup(parsed.values.backup);}console.log(JSON.stringify({operation:command,files:result.files.length,totalBytes:result.totalBytes,schemaHash:result.schemaHash}));return; }
  if (command === 'doctor') { const root = parsed.values.root ?? defaultMediaRoot(); const version = await probeVersion(parsed.values.ffprobe); console.log(JSON.stringify({ ffprobe: !!version, probeVersion: version, diskFreeBytes: await diskFree(root), localImport: true, render: await renderReady(parsed.values.ffprobe) })); return; }
  if (command === 'pair') {
    let config: AgentConfig = await readConfig().catch((e: unknown) => { if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) throw e; return { origin: parsed.values.url ?? 'http://127.0.0.1:8787', mediaRoot: parsed.values.root ?? defaultMediaRoot(), ffprobe: parsed.values.ffprobe ?? defaultProbePath() }; });
    if (!config.pairing) { const input = createInterface({ input: stdin, output: stdout }); const code = (await input.question('Código de vinculación (caduca en 5 minutos): ')).trim(); input.close(); config = { ...config, pairing: { code, name: parsed.values.name ?? 'Agente local', operation: crypto.randomUUID() } }; await writeConfig(config); }
    const version = await probeVersion(config.ffprobe); const response = await new AgentClient(config.origin, '').pair(config.pairing!.code, config.pairing!.name, { ffprobe: !!version, localImport: true, alignment: false }, config.pairing!.operation).catch(async (error: unknown) => {
      if (error instanceof AgentApiError && [404, 409].includes(error.status)) { const { pairing: _expired, ...next } = config; void _expired; await writeConfig(next); console.error('Solicita un nuevo codigo en Configuracion y repite pair.'); } throw error;
    });
    const { pairing: _pairing, ...safe } = config; void _pairing; await writeConfig({ ...safe, ...response }); console.log('Agente vinculado. Credencial guardada fuera del repositorio.'); return;
  }
  if (command === 'export') { const config=await readConfig(); if(!config.token||!parsed.values.project||!parsed.values.package||!parsed.values.output) throw new Error('EXPORT_ARGUMENTS_REQUIRED'); console.log(await exportFromAgent(new AgentClient(config.origin,config.token),config.mediaRoot,parsed.values.project,parsed.values.package,parsed.values.output));return; }
  if (command === 'locate') { const config=await readConfig(); if(!parsed.values.project||!parsed.values.render) throw new Error('PROJECT_AND_RENDER_REQUIRED'); console.log(await locateRender(config.mediaRoot,parsed.values.project,parsed.values.render)); return; }
  if (command === 'import') {
    const config = await readConfig(); if (!config.token || !config.agentId) throw new Error('PAIR_FIRST');
    const result = await importLocalFile(new AgentClient(config.origin, config.token), config, parsed.values.file && parsed.values.project && parsed.values.mime && parsed.values.source ? { file: parsed.values.file, projectId: parsed.values.project, mime: parsed.values.mime, source: parsed.values.source, rights: parsed.values.rights === true } : undefined);
    console.log(JSON.stringify({ assetId: result.id, availability: result.availability, checksum: result.checksum, durationMs: result.durationMs })); return;
  }
  if (command !== 'run') throw new Error('Usa doctor, pair, import, locate, export, backup, verify-backup, restore o run.');
  let config = await readConfig(); if (!config.token || !config.agentId) throw new Error('Vincula primero el agente.'); const client = new AgentClient(config.origin, config.token); let stop = false; let failures = 0; const stopping=new AbortController(); process.once('SIGINT', () => { stop = true; stopping.abort(); }); process.once('SIGTERM', () => { stop = true; stopping.abort(); });
  do { config = { ...config, claimOperation: config.claimOperation ?? crypto.randomUUID() }; await writeConfig(config); try { await client.tick(config.mediaRoot, config.claimOperation!, config.ffprobe, stopping.signal); const { claimOperation: _claim, ...next } = config; void _claim; config = next; await writeConfig(config); failures = 0; } catch (error) { failures++; if (error && typeof error === 'object' && 'status' in error && error.status === 401) throw new Error('Agente revocado o credencial inválida.', { cause: error }); console.error('Conexión o recurso no disponible; se conservará el estado para reintentar.'); }
    if (parsed.values.once || stop) break; await new Promise<void>((done) => { const wake = () => { clearTimeout(timer); process.off('SIGINT', wake); process.off('SIGTERM', wake); done(); }; const timer = setTimeout(wake, Math.min(30000, 5000 * 2 ** Math.min(failures, 3))); process.once('SIGINT', wake); process.once('SIGTERM', wake); });
  } while (!stop);
}
main().catch((error:unknown) => { if(['export','backup','restore','verify-backup'].includes(parsed.positionals[0]??'')&&error instanceof Error&&['DESTINATION_EXISTS','QUIESCENCE_REQUIRED','BACKUP_ARGUMENTS_REQUIRED','UNSAFE_BACKUP_PATH','BACKUP_INTEGRITY','BACKUP_SCHEMA_MISMATCH','BACKUP_LIMIT','SOURCE_CHANGED','EXPORT_EXISTS','EXPORT_CHANGED','INCOMPLETE_EXPORT_USE_NEW_DIRECTORY','DISK_FULL','ABSOLUTE_OUTPUT_REQUIRED','LOCAL_FILE_MISSING','UNSAFE_OUTPUT','EXPORT_ARGUMENTS_REQUIRED','EXPORT_MISMATCH'].includes(error.message))console.error(error.message); console.error('No se pudo completar la operación del agente. Revisa configuración, vinculación y diagnóstico.'); process.exitCode = 1; });
