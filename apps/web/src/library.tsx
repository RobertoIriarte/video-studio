import { useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { assetAccessSchema, assetListSchema, assetSchema, bytesHash, importDtoSchema, importListSchema, importInputSchema, projectListSchema, WEB_IMPORT_MAX_BYTES } from '@video-studio/contracts';
import type { z } from 'zod';
import type { assetSchema as assetType } from '@video-studio/contracts';
import { api } from './api';
import { usePolling } from './use-polling';
import { Button } from './components/ui/button';
import { ErrorBanner, Refresh } from './production-views';

type UploadTask = { bytes: Uint8Array; input: z.infer<typeof importInputSchema>; intentKey: string; finalizeKey: string; id?: string };
export function LibraryPage() {
  const { id: routeProject } = useParams(); const [params, setParams] = useSearchParams(); const project = params.get('projectId') ?? routeProject ?? ''; const type = params.get('type') ?? ''; const q = params.get('q') ?? ''; const cursor = params.get('cursor') ?? '';
  const query = new URLSearchParams(); if (project) query.set('projectId', project); if (type) query.set('type', type); if (q) query.set('q', q); if (cursor) query.set('cursor', cursor);
  const assets = usePolling(`/assets?${query}`, assetListSchema); const imports = usePolling(`/imports${project ? `?projectId=${project}` : ''}`, importListSchema); const projects = usePolling('/projects', projectListSchema);
  const [file, setFile] = useState<File | null>(null); const [source, setSource] = useState(''); const [note, setNote] = useState(''); const [prompt, setPrompt] = useState(''); const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(); const [notice, setNotice] = useState(''); const task = useRef<UploadTask | null>(null); const lock = useRef(false);
  const filter = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); next.delete('cursor'); setParams(next); };
  const upload = async () => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(undefined); setNotice('');
    try {
      if (!task.current) {
        if (!file || file.size > WEB_IMPORT_MAX_BYTES) throw new Error('Selecciona un archivo de hasta 5 MiB. Los mayores requieren importación local.');
        const bytes = new Uint8Array(await file.arrayBuffer()); const extension = file.name.split('.').at(-1)?.toLowerCase();
        const mime = file.type === 'audio/x-wav' ? 'audio/wav' : file.type || ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', mp4: 'video/mp4' }[extension ?? '']);
        const input = importInputSchema.parse({ projectId: project, mime, bytes: bytes.length, checksum: await bytesHash(bytes), license: { source, note, rightsAcknowledged: rights }, prompt: prompt || null });
        task.current = { bytes, input, intentKey: crypto.randomUUID(), finalizeKey: crypto.randomUUID() };
      }
      const current = task.current;
      if (!current.id) { const intent = await api('/assets/import', importDtoSchema, { method: 'POST', headers: { 'idempotency-key': current.intentKey }, body: JSON.stringify(current.input) }); current.id = intent.id; }
      const uploaded = await api(`/imports/${current.id}/content`, importDtoSchema, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(current.bytes) });
      if (uploaded.requiresInspection) setNotice('Archivo recibido. Requiere inspección del agente local antes de publicarlo.');
      else { await api(`/assets/${current.id}/finalize`, assetSchema, { method: 'POST', headers: { 'idempotency-key': current.finalizeKey }, body: '{}' }); setNotice('Recurso verificado y disponible en la biblioteca.'); }
      task.current = null; setFile(null); assets.refresh(); imports.refresh();
    } catch (e) { setError(e instanceof Error ? e : new Error('No se pudo importar.')); }
    finally { lock.current = false; setBusy(false); }
  };
  return <><h1 className="content-title">Biblioteca privada</h1><p>Recursos propios con procedencia, licencia y checksum. Ninguna URL externa se descarga automáticamente.</p><Refresh view={assets} /><ErrorBanner error={assets.error} />
    <div className="filter-bar library-filters"><label>Proyecto de biblioteca<select aria-label="Proyecto de biblioteca" value={project} disabled={busy || !!task.current} onChange={(e) => filter('projectId', e.target.value)}><option value="">Todos los proyectos</option>{project && !projects.data?.items.some((p) => p.id === project) && <option value={project}>Proyecto seleccionado</option>}{projects.data?.items.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label>Tipo de recurso<select aria-label="Tipo de recurso" value={type} onChange={(e) => filter('type', e.target.value)}><option value="">Todos</option><option value="IMAGE">Imagen</option><option value="VIDEO">Video</option><option value="AUDIO">Audio</option></select></label><label>Buscar por prompt o licencia<input value={q} maxLength={100} onChange={(e) => filter('q', e.target.value)} /></label></div>
    <form className="panel live-form library-import" onSubmit={(e) => { e.preventDefault(); void upload(); }}><h2>Importar un recurso</h2><p>Hasta 5 MiB por carga web. PNG/JPEG/WebP y WAV se verifican aquí; MP3/Ogg/MP4 esperan inspección local.</p><fieldset disabled={busy || !!task.current}><label>Archivo<input type="file" accept=".png,.jpg,.jpeg,.webp,.wav,.mp3,.ogg,.mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label><label>Procedencia o licencia<input required maxLength={2048} value={source} onChange={(e) => setSource(e.target.value)} /></label><label>Notas de licencia<textarea aria-label="Notas de licencia" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} /></label><label>Prompt del recurso<textarea aria-label="Prompt del recurso" maxLength={16000} value={prompt} onChange={(e) => setPrompt(e.target.value)} /></label><label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> Confirmo que tengo derechos para utilizar este recurso</label></fieldset>
      <ErrorBanner error={error} />{notice && <p role="status">{notice}</p>}<Button type="submit" disabled={busy || !assets.online || !project || (!file && !task.current) || !rights}>{busy ? 'Importando…' : task.current ? 'Reintentar importación pendiente' : 'Importar recurso'}</Button>{task.current && !busy && <Button type="button" variant="ghost" onClick={() => { task.current = null; setFile(null); setError(undefined); }}>Descartar intento local</Button>}{!project && <p>Selecciona un proyecto para importar.</p>}</form>
    {!assets.data ? <p role="status">{assets.error ? 'Biblioteca no disponible.' : 'Cargando recursos…'}</p> : !assets.data.items.length ? <section className="panel"><h2>No hay recursos con estos filtros</h2><p>Importa uno propio o ajusta el filtro.</p></section> : <div className="production-jobs">{assets.data.items.map((asset) => <AssetCard key={asset.id} asset={asset} />)}</div>}
    <div className="live-actions">{cursor && <Button variant="outline" onClick={() => { const next = new URLSearchParams(params); next.delete('cursor'); setParams(next); }}>Volver al inicio</Button>}{assets.data?.nextCursor && <Button onClick={() => { const next = new URLSearchParams(params); next.set('cursor', assets.data!.nextCursor!); setParams(next); }}>Siguientes recursos</Button>}</div>
    <section className="panel"><h2>Importaciones recientes</h2><ErrorBanner error={imports.error} />{imports.data?.items.length ? imports.data.items.map((i) => <p key={i.id}>{i.mime} · {i.bytes} bytes · {i.error ? 'Archivo rechazado tras inspección' : i.state === 'VERIFIED' ? 'Verificada' : i.requiresInspection ? 'Esperando inspección local' : i.state === 'PENDING' ? 'Esperando archivo' : 'Pendiente de finalizar'}</p>) : <p>Sin importaciones registradas.</p>}</section>
  </>;
}
function AssetCard({ asset }: { asset: z.infer<typeof assetType> }) {
  const access = usePolling(`/assets/${asset.id}/access`, assetAccessSchema, 240000); const [failed, setFailed] = useState(false);
  return <article className="panel library-asset"><h2>{asset.type === 'IMAGE' ? 'Imagen' : asset.type === 'AUDIO' ? 'Audio' : 'Video'} · {asset.id.slice(0, 8)}</h2><p>{asset.availability} · {asset.bytes} bytes · {asset.width && asset.height ? `${asset.width}×${asset.height}` : ''}{asset.durationMs ? ` · ${asset.durationMs / 1000} s` : ''}</p>
    {access.data?.url && !failed ? asset.type === 'IMAGE' ? <img className="library-image" src={access.data.url} alt="Recurso privado importado" onError={() => setFailed(true)} /> : asset.type === 'AUDIO' ? <audio aria-label="Audio privado" controls preload="none" src={access.data.url} onError={() => setFailed(true)} /> : <video aria-label="Video privado" controls preload="none" src={access.data.url} onError={() => setFailed(true)} /> : <p>{failed ? 'No se pudo reproducir. Actualiza el acceso o revisa el archivo.' : 'Preview remota no disponible; puede requerir el agente local.'}</p>}
    <ErrorBanner error={access.error} />{access.data?.url && <a href={access.data.url} download>Descargar recurso original</a>}{failed && <Button variant="outline" onClick={() => { setFailed(false); access.refresh(); }}>Reintentar preview</Button>}<p>Origen: {asset.origin} · Licencia: {String(asset.license.source ?? 'Sin verificar')}</p><p>Checksum: <code>{asset.checksum}</code></p>{asset.prompt && <p>Prompt: {asset.prompt}</p>}<p>Sin costo de proveedor registrado para esta importación.</p><Link to={`/projects/${asset.projectId}`}>Ver proyecto</Link>
  </article>;
}
