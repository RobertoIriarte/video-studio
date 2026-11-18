import { VoiceAssetPicker } from './voice';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { jobDtoSchema, manualPacketSchema, manualResultSchema } from '@video-studio/contracts';
import { usePolling } from './use-polling';
import { useCommand } from './use-command';
import { CommandError, ErrorBanner, Refresh } from './production-views';
import { Button } from './components/ui/button';
function downloadReference(text: string, id: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `referencia-${id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ManualPage() {
  const { id } = useParams(); const view = usePolling(`/jobs/${id}/manual`, manualPacketSchema); const [text, setText] = useState(''); const [error, setError] = useState(false); const [saved, setSaved] = useState(false);
  const command = useCommand(() => { setSaved(true); view.refresh(); }); const packet = view.data;
  return <><h1 className="content-title">Resultado manual asistido</h1><Link to={`/generations/${id}`}>Volver al trabajo</Link><Refresh view={view} /><ErrorBanner error={view.error} /><CommandError command={command} />
    {packet && <><section className="panel live-form"><h2>Generar con tu herramienta</h2><p>Estado: {packet.job.status}. La suscripción y sus límites se gestionan en cada servicio. El costo externo no se conoce.</p><ol>{packet.instructions.map((step) => <li key={step}>{step}</li>)}</ol><div className="live-actions"><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">Abrir ChatGPT</a><a href="https://flow.google.com/" target="_blank" rel="noreferrer">Abrir Flow</a><Link to={`/library?projectId=${packet.job.projectId}`}>Importar o consultar stock propio</Link></div><label>Prompt para copiar<textarea rows={8} readOnly value={packet.prompt} /></label><Button variant="outline" onClick={() => { navigator.clipboard.writeText(packet.prompt).catch(() => undefined); }}>Copiar prompt</Button>
      {packet.references.map((r) => <details key={r.ref.id}><summary>Referencia {r.ref.kind} · {r.ref.id}</summary><Button variant="outline" onClick={() => downloadReference(r.text, r.ref.id)}>Descargar referencia JSON</Button><label>Contenido de referencia<textarea rows={8} readOnly value={r.text} /></label>{r.ref.kind === 'ASSET' && <Link to={`/library?projectId=${packet.job.projectId}`}>Abrir recurso autorizado en Biblioteca</Link>}</details>)}
      <label>Plantilla del resultado<textarea rows={8} readOnly value={packet.template} /></label><Button variant="outline" disabled={command.busy || command.retryable} onClick={() => { setText(packet.template); setSaved(false); }}>Usar plantilla editable</Button></section>
      <form className="panel live-form" onSubmit={(e) => { e.preventDefault(); try { const result = manualResultSchema.parse(JSON.parse(text) as unknown); setError(false); command.send(`/jobs/${id}/manual`, jobDtoSchema, { expectedRevision: packet.job.revision, result }); } catch { setError(true); } }}><h2>Importar resultado</h2>{packet.job.kind === 'VOICE' && <VoiceAssetPicker projectId={packet.job.projectId} disabled={command.busy || command.retryable} onSelect={(assetId) => { setText(JSON.stringify({ kind: 'VOICE', assetId }, null, 2)); setSaved(false); }} />}<label>JSON del resultado<textarea rows={14} required maxLength={1048576} value={text} disabled={command.busy || command.retryable} onChange={(e) => { setText(e.target.value); setSaved(false); }} /></label>{error && <p role="alert">JSON inválido o incompatible con el contrato. Revisa la plantilla y los campos.</p>}<p>Al confirmar se valida el resultado y se reanuda el trabajo; las candidatas requieren aprobación antes de activarse.</p><Button type="submit" disabled={command.busy || command.retryable || !view.online || packet.job.status !== 'WAITING_MANUAL'}>Validar y guardar resultado</Button>{saved && <p role="status">Resultado guardado. Revisa la candidata en el proyecto o el siguiente trabajo en Generaciones.</p>}</form></>}
  </>;
}
