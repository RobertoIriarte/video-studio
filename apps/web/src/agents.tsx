import { useState } from 'react';
import { agentDtoSchema, agentListSchema, pairingDtoSchema } from '@video-studio/contracts';
import type { z } from 'zod';
import { usePolling } from './use-polling';
import { useCommand } from './use-command';
import { CommandError, Dialog, ErrorBanner, Refresh } from './production-views';
import { Button } from './components/ui/button';
export function AgentStatus() {
  const view = usePolling('/agents', agentListSchema);
  return <>{!view.online || view.error ? 'Estado del agente no disponible' : view.data?.items.some((a) => a.status === 'ONLINE') ? 'Agente conectado' : view.data?.items.some((a) => a.status === 'OFFLINE') ? 'Agente desconectado' : 'Agente sin conectar'}</>;
}
export function AgentsPage() {
  const view = usePolling('/agents', agentListSchema); const [name, setName] = useState('Mi equipo'); const [pairing, setPairing] = useState<z.infer<typeof pairingDtoSchema> | null>(null); const [revoke, setRevoke] = useState<z.infer<typeof agentDtoSchema> | null>(null);
  const command = useCommand((path, value) => { if (path.endsWith('/pairing')) setPairing(pairingDtoSchema.parse(value)); setRevoke(null); view.refresh(); });
  return <><h1 className="content-title">Agente local</h1><p>El equipo se conecta a la API; no abre puertos entrantes. Los archivos locales permanecen en el equipo salvo copia explícita.</p><Refresh view={view} /><ErrorBanner error={view.error} /><CommandError command={command} />
    <form className="panel live-form" onSubmit={(e) => { e.preventDefault(); command.send('/agents/pairing', pairingDtoSchema, { label: name }); }}><h2>Vincular un equipo</h2><label>Nombre de referencia<input required maxLength={80} value={name} disabled={command.busy || command.retryable} onChange={(e) => setName(e.target.value)} /></label><Button type="submit" disabled={command.busy || !view.online}>Crear código de vinculación</Button></form>
    {pairing && <section className="panel library-asset"><h2>Código de un solo uso</h2><p>Caduca a las {new Date(pairing.expiresAt).toLocaleTimeString('es')}. Introdúcelo en la consola del agente de tu equipo.</p><code>{pairing.code}</code><div className="live-actions"><Button variant="outline" onClick={() => { navigator.clipboard.writeText(pairing.code).catch(() => undefined); }}>Copiar código</Button><Button variant="ghost" onClick={() => setPairing(null)}>Ocultar código</Button></div><p>La credencial definitiva se entrega solamente al agente; no se muestra aquí.</p></section>}
    {!view.data ? <p role="status">{view.error ? 'Diagnóstico no disponible.' : 'Cargando agentes…'}</p> : !view.data.items.length ? <section className="panel"><h2>Sin equipos vinculados</h2><p>Vincula el agente y ejecútalo para inspeccionar recursos y trabajos compatibles.</p></section> : <div className="production-jobs">{view.data.items.map((agent) => <article className="panel" key={agent.id}><h2>{agent.name}</h2><p>{agent.status === 'ONLINE' ? 'Conectado' : agent.status === 'REVOKED' ? 'Revocado' : 'Desconectado'} · Última señal: {agent.lastSeenAt ? new Date(agent.lastSeenAt).toLocaleString('es') : 'Sin heartbeat'}</p><p>Espacio libre: {(agent.diskFreeBytes / 1024 ** 3).toFixed(1)} GiB.</p><p>FFprobe: {agent.probeVersion ?? 'No disponible'} · importación local {agent.capabilities.localImport ? 'disponible' : 'no disponible'} · alineación {agent.capabilities.alignment ? 'disponible' : 'no disponible'} · render {agent.capabilities.render ? 'disponible' : 'no disponible'}</p>{agent.status !== 'REVOKED' && <Button variant="outline" disabled={command.busy} onClick={() => setRevoke(agent)}>Revocar acceso de {agent.name}</Button>}</article>)}</div>}
    {revoke && <Dialog title="¿Revocar el acceso del equipo?" busy={command.busy} onClose={() => setRevoke(null)}><p>Se bloqueará su credencial y expirarán sus leases. El historial y los archivos se conservan.</p><Button disabled={command.busy} onClick={() => command.send(`/agents/${revoke.id}/revoke`, agentDtoSchema, { expectedRevision: revoke.revision })}>Confirmar revocación</Button><CommandError command={command} /></Dialog>}
  </>;
}
