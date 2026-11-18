import { Link, useParams } from 'react-router-dom';
import { scenesListSchema, assetListSchema } from '@video-studio/contracts';
import { usePolling } from './use-polling';
import { ErrorBanner, Refresh } from './production-views';
import { Button } from './components/ui/button';
import { useState } from 'react';
export function VoicePage() {
  const { id } = useParams(); const [cursor, setCursor] = useState(''); const view = usePolling(`/projects/${id}/scenes${cursor ? `?cursor=${cursor}` : ''}`, scenesListSchema);
  return <><h1 className="content-title">Voz y sincronización</h1><p>Importa audio con licencia y duración verificada. Desde el trabajo Voz puedes aportar tiempos manuales o una estimación revisable. Aprobar activa la candidata y actualiza sus dependientes.</p><div className="live-actions"><Link to={`/library?projectId=${id}&type=AUDIO`}>Importar audio</Link><Link to={`/generations?projectId=${id}`}>Abrir trabajos de voz</Link></div><Refresh view={view} /><ErrorBanner error={view.error} />{view.data?.items.map((s) => <section className="panel" key={s.id}><h2>{s.stableKey}</h2><p>Duración activa: {s.durationMs / 1000} s.</p><Link to={`/projects/${id}/scenes/${s.id}`}>Revisar narración, segmentos y versiones</Link></section>)}<div className="live-actions">{cursor && <Button variant="outline" onClick={() => setCursor('')}>Volver al inicio</Button>}{view.data?.nextCursor && <Button onClick={() => setCursor(view.data!.nextCursor!)}>Siguientes escenas</Button>}</div></>;
}
export function VoiceAssetPicker({ projectId, onSelect, disabled }: { projectId: string; onSelect: (id: string) => void; disabled: boolean }) {
  const [cursor, setCursor] = useState(''); const view = usePolling(`/assets?projectId=${projectId}&type=AUDIO${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, assetListSchema);
  return <fieldset className="live-form"><legend>Audio verificado</legend><p>Sin tiempos aportados se estima la posición de las palabras según la duración total. Esta estimación no reconoce la voz; revisa y corrige los segmentos antes de aprobar.</p><ErrorBanner error={view.error} /><label>Seleccionar audio de Biblioteca<select value="" disabled={disabled} onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}><option value="">Elegir recurso…</option>{view.data?.items.map((a) => <option key={a.id} value={a.id}>{a.id} · {(a.durationMs ?? 0) / 1000} s · {a.availability}</option>)}</select></label>{view.data?.nextCursor && <Button type="button" variant="outline" onClick={() => setCursor(view.data!.nextCursor!)}>Más audios</Button>}{cursor && <Button type="button" variant="ghost" onClick={() => setCursor('')}>Primeros audios</Button>}<Link to={`/library?projectId=${projectId}&type=AUDIO`}>Importar otro audio</Link></fieldset>;
}
