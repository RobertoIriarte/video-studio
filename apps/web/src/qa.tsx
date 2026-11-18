import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { manifestViewSchema, qaViewSchema, qaReportSchema, qaRepairResultSchema } from '@video-studio/contracts';
import { usePolling } from './use-polling';
import { useCommand } from './use-command';
import { ContentNavigation } from './content-views';
import { ErrorBanner, CommandError, Refresh, Dialog } from './production-views';
import { Button } from './components/ui/button';

export function QaPage() {
  const { id } = useParams();
  const [cursor, setCursor] = useState('');
  const reports = usePolling(`/projects/${id}/qa${cursor ? `?cursor=${cursor}` : ''}`, qaViewSchema);
  const manifests = usePolling(`/projects/${id}/manifests`, manifestViewSchema);
  const [ack, setAck] = useState(false);
  const [confirmation, setConfirmation] = useState<{path:string;body:unknown;repair:boolean}|null>(null);
  const [repaired, setRepaired] = useState(false);
  const command = useCommand((path) => { setRepaired(path.endsWith('/repair')); setConfirmation(null); setAck(false); reports.refresh(); manifests.refresh(); });
  const active = manifests.data?.items.find((m) => m.id === manifests.data!.activeId);
  const latest = reports.data?.items.find((r) => r.kind === 'PRE_RENDER' && r.manifestId === active?.id);
  const current = reports.data?.current && manifests.data?.current && !cursor;
  return <><ContentNavigation id={id!}/><h1 className="content-title">Control de calidad</h1>
    <p>Revisión editorial y técnica del snapshot. Comprueba personalmente afirmaciones, fuentes, licencias, voz y continuidad en el preview. El análisis automático no verifica la verdad de las afirmaciones.</p>
    <Refresh view={reports}/><ErrorBanner error={reports.error ?? manifests.error}/><CommandError command={command}/>
    <section className="panel"><h2>QA antes del render</h2><p>{active ? `Montaje v${active.versionNo} · ${active.contentHash.slice(0,12)}` : 'Activa un montaje antes de analizar.'}</p>
      {!current && <p>El montaje debe estar vigente. Si cambias una fuente, crea y activa un nuevo snapshot y repite QA.</p>}
      <div className="live-actions"><Link to={`/projects/${id}/edit`}>Revisar montaje y preview</Link><Link to={`/projects/${id}/render`}>Ir a render</Link>
      <Button disabled={!current || !active || !reports.online || command.busy} onClick={() => setConfirmation({path:`/projects/${id}/qa/run`,body:{expectedRevision:reports.data!.revision,manifestHash:active!.contentHash},repair:false})}>Analizar snapshot</Button></div>
      {latest?.status === 'PENDING' && current && <><label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)}/>He revisado contenido, fuentes, licencias, sincronía y advertencias en el preview</label><Button disabled={!ack || command.busy || !reports.online} onClick={() => setConfirmation({path:`/projects/${id}/qa/${latest.id}/approve`,body:{expectedRevision:latest.revision,manifestHash:latest.manifestHash,acknowledgeEditorialReview:true},repair:false})}>Aprobar QA editorial</Button></>}
      {latest?.status === 'BLOCKED' && <p role="status">Render bloqueado: resuelve los hallazgos y analiza un nuevo snapshot.</p>}
      {latest?.status === 'APPROVED' && current && <p role="status">QA aprobado para este snapshot.</p>}
    </section>
    {reports.data?.items.map((r) => <section className="panel" key={r.id}><h2>Informe v{r.versionNo} · {r.kind === 'FINAL' ? 'QA final' : 'Antes del render'}</h2><p>{r.status === 'APPROVED' ? 'Aprobado' : r.status === 'BLOCKED' ? 'Bloqueado' : 'Pendiente de revisión editorial'} · manifest {r.manifestHash.slice(0,12)}</p>
      {r.kind === 'FINAL' && r.status === 'APPROVED' && <p>Perfil, decodificación, audio, frames negros y silencios comprobados por el agente. Conserva la revisión editorial aprobada del snapshot.</p>}
      {!r.findings.length && <p>Sin hallazgos automáticos.</p>}
      <ul>{r.findings.map((f) => <li key={f.id}><strong>{f.severity === 'BLOCKER' ? 'Bloqueo' : f.severity === 'WARN' ? 'Advertencia' : 'Información'} · {f.component}</strong><p>{f.message}</p><div className="live-actions">{f.sceneId && <Link to={`/projects/${id}/scenes/${f.sceneId}`}>Revisar escena</Link>}
        {current && r.manifestId === active?.id && r.status !== 'APPROVED' && f.sceneId && f.suggestedScope && <Button variant="outline" disabled={command.busy || !reports.online} onClick={() => setConfirmation({path:`/projects/${id}/qa/${r.id}/repair`,body:{expectedRevision:reports.data!.revision,findingId:f.id},repair:true})}>Corregir {f.suggestedScope}</Button>}</div></li>)}</ul>
    </section>)}
    <p>Máximo dos solicitudes de corrección por snapshot. Cada corrección afecta el componente indicado de una escena y crea una candidata; revisa y activa explícitamente. Después crea un nuevo montaje y repite QA.</p>
    {repaired && <p role="status">Corrección registrada. Consulta Generaciones para importar el resultado y revisar su candidata.</p>}
    <div className="live-actions">{cursor && <Button onClick={() => setCursor('')}>Informes recientes</Button>}{reports.data?.nextCursor && <Button onClick={() => setCursor(reports.data!.nextCursor!)}>Más informes</Button>}</div>
    {confirmation && <Dialog title={confirmation.repair ? '¿Crear corrección localizada?' : '¿Confirmar revisión de QA?'} busy={command.busy} onClose={() => setConfirmation(null)}><p>{confirmation.repair ? 'Se registra una solicitud acotada a la escena y componente del hallazgo. No activa versiones ni autoriza proveedores de pago. Consulta Generaciones para completar el trabajo manual.' : 'La revisión se aplica al hash exacto seleccionado. Un bloqueo requiere corregir las fuentes y crear otro snapshot.'}</p><Button disabled={command.busy} onClick={() => command.send(confirmation.path, confirmation.repair ? qaRepairResultSchema : qaReportSchema, confirmation.body)}>Confirmar QA</Button><CommandError command={command}/></Dialog>}
  </>;
}
