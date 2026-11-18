import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useBeforeUnload, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { meResponseSchema, projectDetailSchema, projectInputSchema, projectListSchema, projectStatusSchema, inputTypeSchema, projectStyleSchema, modalitySchema, productionModeSchema } from '@video-studio/contracts';
import type { AuthUser, ProjectDetail, ProjectInput, ProjectDto } from '@video-studio/contracts';
import { z } from 'zod';
import { api, ApiFailure } from './api';
import { Button } from './components/ui/button';
import { Shell } from './app';
import { YoutubePage } from './youtube';
import { QaPage } from './qa';
import { RenderPage } from './render';
import { MontagePage } from './montage';
import { VoicePage } from './voice';
import { ManualPage } from './manual';
import { AgentsPage } from './agents';
import { LibraryPage } from './library';
import { ResearchPage, ScriptPage, ScenesPage, ScenePage } from './content-views';
import { GenerationsPage, JobDetailPage, PreferredProviderField, ProductionPage, ProvidersPage } from './production-views';

const okSchema = z.object({ ok: z.literal(true) });
const labels: Record<string, string> = { TOPIC: 'Tema', SCRIPT: 'Guion propio', SOURCES: 'Fuentes propias', DOCUMENTARY: 'Documental cinematográfico', PREMIUM_REALISTIC: 'Realista premium', HORROR_MYSTERY: 'Terror / misterio', DYNAMIC_IMAGES: 'Imágenes dinámicas · costo relativo bajo', HYBRID: 'Híbrida · costo relativo medio', CINEMATIC: 'Cinematográfica · costo relativo alto', EXPLAINER: 'Explicativa · costo relativo bajo', AUTO: 'Automático', SUPERVISED: 'Supervisado', DRAFT: 'Borrador', ARCHIVED: 'Archivado' };
const defaultInput = (): ProjectInput => ({ title: '', inputType: 'TOPIC', inputText: '', settings: { language: 'es', audience: 'Público general', objective: 'YOUTUBE_LONG', targetDurationMs: 600000, style: 'DOCUMENTARY', modality: 'DYNAMIC_IMAGES', mode: 'SUPERVISED', budget: { currency: 'USD', maxMicros: 0 }, providerPolicy: { allowPaidFallback: false, preferredIds: [] }, checkpoints: ['SCRIPT', 'DIRECTION'] } });
function ErrorNotice({ error }: { error: unknown }) { return error ? <p role="alert" className="live-error">{error instanceof Error ? error.message : 'No se pudo completar la operación.'}</p> : null; }

function ContentRoute({ page: Page }: { page: typeof ResearchPage }) {
  const { id } = useParams(); const [params] = useSearchParams();
  return <Page key={`${id}:${params.toString()}`} />;
}

export function PrivateApp() {
  const [user, setUser] = useState<AuthUser | null>(); const [error, setError] = useState<unknown>();
  const load = useCallback(() => { setError(undefined); api('/me', meResponseSchema).then((data) => setUser(data.user)).catch((e: unknown) => { if (e instanceof ApiFailure && e.status === 401) setUser(null); else setError(e); }); }, []);
  useEffect(load, [load]);
  useEffect(() => { const expired = () => setUser(null); window.addEventListener('studio:session-expired', expired); return () => window.removeEventListener('studio:session-expired', expired); }, []);
  if (error) return <main className="live-main"><h1>Acceso privado</h1><ErrorNotice error={error} /><Button onClick={load}>Reintentar</Button></main>;
  if (user === undefined) return <main className="live-main" role="status">Comprobando sesión…</main>;
  if (!user) return <Login onLogin={load} />;
  return <Routes><Route element={<Shell identity={user.name} onLogout={() => { api('/auth/sign-out', okSchema, { method: 'POST', body: '{}' }).then(() => setUser(null)).catch(setError); }} />}> <Route path="/generations/:id/manual" element={<ManualPage />} /><Route path="/generations/:id" element={<JobDetailPage />} /><Route path="/projects" element={<ProjectList />} /><Route path="/projects/new" element={<WizardRoute />} /><Route path="/projects/:id" element={<ProductionPage />} /><Route path="/projects/:id/research" element={<ContentRoute page={ResearchPage} />} /><Route path="/projects/:id/script" element={<ContentRoute page={ScriptPage} />} /><Route path="/projects/:id/youtube" element={<YoutubePage />} /><Route path="/projects/:id/qa" element={<QaPage />} /><Route path="/projects/:id/render" element={<RenderPage />} /><Route path="/projects/:id/edit" element={<MontagePage />} /><Route path="/projects/:id/voice" element={<VoicePage />} /><Route path="/projects/:id/assets" element={<LibraryPage />} /><Route path="/projects/:id/scenes" element={<ContentRoute page={ScenesPage} />} /><Route path="/projects/:id/direction" element={<ContentRoute page={ScenesPage} />} /><Route path="/projects/:projectId/scenes/:id" element={<ContentRoute page={ScenePage} />} /><Route path="/scenes/:id" element={<ContentRoute page={ScenePage} />} /><Route path="/projects/:id/configure" element={<WizardRoute />} /><Route path="/" element={<Navigate to="/projects" replace />} /><Route path="/login" element={<Navigate to="/projects" replace />} /><Route path="/providers" element={<ProvidersPage />} /><Route path="/settings" element={<AgentsPage />} /><Route path="*" element={<h1>Recurso no encontrado</h1>} /><Route path="/library" element={<LibraryPage />} /><Route path="/generations" element={<GenerationsPage />} /></Route></Routes>;
}
function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState<unknown>(); const [busy, setBusy] = useState(false);
  return <main className="live-main login-panel panel"><span className="eyebrow">VIDEO STUDIO · PRIVADO</span><h1>Acceso privado</h1><p>Usa la cuenta del propietario configurada desde la terminal local.</p><form className="live-form" onSubmit={(event) => { event.preventDefault(); if (busy) return; const data = new FormData(event.currentTarget); setBusy(true); setError(undefined); api('/auth/sign-in/email', okSchema, { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) }).then(onLogin).catch(setError).finally(() => setBusy(false)); }}><label>Correo<input name="email" type="email" autoComplete="username" required /></label><label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label><ErrorNotice error={error} /><Button disabled={busy} type="submit">{busy ? 'Entrando…' : 'Iniciar sesión'}</Button></form></main>;
}
function ProjectList() {
  const [params, setParams] = useSearchParams(); const [items, setItems] = useState<ProjectDto[]>(); const [next, setNext] = useState<string | null>(null); const [error, setError] = useState<unknown>(); const [retry, setRetry] = useState(0);
  const query = params.toString();
  useEffect(() => { let active = true; setItems(undefined); setError(undefined); api(`/projects?${query}`, projectListSchema).then((data) => { if (active) { setItems(data.items); setNext(data.nextCursor); } }).catch((e: unknown) => { if (active) setError(e); }); return () => { active = false; }; }, [query, retry]);
  const filter = (key: string, value: string) => { const p = new URLSearchParams(params); if (value) p.set(key, value); else p.delete(key); p.delete('cursor'); setParams(p); };
  return <><div className="page-heading"><div><span className="eyebrow">TU ESPACIO PRIVADO</span><h1>Proyectos</h1><p>Historias guardadas, listas para continuar.</p></div><Button asChild><Link to="/projects/new">Nuevo proyecto</Link></Button></div><div className="filters"><label>Buscar proyectos<input value={params.get('q') ?? ''} maxLength={200} onChange={(e) => filter('q', e.target.value)} /></label><label>Estado<select value={params.get('status') ?? ''} onChange={(e) => filter('status', e.target.value)}><option value="">Todos</option>{projectStatusSchema.options.filter((s) => s !== 'ARCHIVED').map((s) => <option key={s} value={s}>{labels[s] ?? s}</option>)}</select></label><span>Más recientes primero</span></div><ErrorNotice error={error} />{error ? <Button onClick={() => setRetry(retry + 1)}>Reintentar</Button> : !items ? <p role="status">Cargando proyectos…</p> : items.length ? <section className="project-grid">{items.map((p) => <Link className="panel" key={p.id} to={`/projects/${p.id}`}><span className="status-badge">{labels[p.status] ?? p.status}</span><h2>{p.title}</h2><p>{labels[p.settings.style]} · {p.settings.targetDurationMs / 60000} min</p><small>Actualizado {new Date(p.updatedAt).toLocaleString('es')}</small></Link>)}</section> : <section className="panel"><h2>No hay proyectos</h2><p>Crea un borrador o cambia los filtros.</p></section>}<div className="live-actions">{params.has('cursor') && <Button onClick={() => filter('cursor', '')}>Volver al inicio</Button>}{next && <Button onClick={() => { const p = new URLSearchParams(params); p.set('cursor', next); setParams(p); }}>Siguiente página</Button>}</div></>;
}
function WizardRoute() {
  const { id } = useParams();
  // Una identidad nueva necesita su propia carga: nunca sobrescribir una edición
  // con la lectura pendiente de otra instancia (incluido new → configure).
  return <Wizard key={id ?? 'new'} />;
}
function Wizard() {
  const { id } = useParams(); const navigate = useNavigate();
  const [input, setInput] = useState<ProjectInput>(defaultInput); const [record, setRecord] = useState<ProjectDetail>(); const [step, setStep] = useState(1); const [loaded, setLoaded] = useState(!id); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(); const [fields, setFields] = useState<string[]>([]);
  const operation = useRef(crypto.randomUUID()); const lock = useRef(false); const internal = useRef(false); const pendingCreate = useRef<{ key: string; body: string } | null>(null);
  useEffect(() => { if (!id) return; let active = true; api(`/projects/${id}`, projectDetailSchema).then((p) => { if (!active) return; setRecord(p); setInput({ title: p.title, inputType: p.inputType, inputText: p.inputText, settings: p.settings }); setStep(p.wizardStep); setLoaded(true); setDirty(false); }).catch(setError); return () => { active = false; }; }, [id]);
  useBeforeUnload(useCallback((event) => { if (dirty) event.preventDefault(); }, [dirty]));
  const blocker = useBlocker(() => dirty && !internal.current);
  const edit = (next: ProjectInput) => { setInput(next); setDirty(true); setError(undefined); setFields([]); };
  const settings = (next: Partial<ProjectInput['settings']>) => edit({ ...input, settings: { ...input.settings, ...next } });
  const save = async (destination: number, finish = false) => {
    if (lock.current) return;
    const parsed = projectInputSchema.safeParse(input);
    if (!parsed.success) { setError(new Error('Revisa los campos indicados antes de guardar.')); setFields(parsed.error.issues.map((i) => i.path.join('.'))); return; }
    lock.current = true; setBusy(true); setError(undefined);
    try {
      let saved: ProjectDetail;
      if (record) saved = await api(`/projects/${record.id}`, projectDetailSchema, { method: 'PATCH', body: JSON.stringify({ ...parsed.data, expectedRevision: record.revision, wizardStep: destination }) });
      else {
        const body = JSON.stringify({ ...parsed.data, wizardStep: destination });
        // Una respuesta perdida se reconcilia con el mismo key y payload antes de editar.
        if (pendingCreate.current && pendingCreate.current.body !== body) throw new Error('Reintenta primero el guardado anterior o recarga para reconciliarlo.');
        pendingCreate.current ??= { key: operation.current, body };
        saved = await api('/projects', projectDetailSchema, { method: 'POST', headers: { 'idempotency-key': pendingCreate.current.key }, body: pendingCreate.current.body });
      }
      setRecord(saved); setStep(destination); setDirty(false); pendingCreate.current = null;
      if (!id || finish) { internal.current = true; navigate(finish ? `/projects/${saved.id}` : `/projects/${saved.id}/configure`, { replace: true }); }
    } catch (e) { setError(e); if (e instanceof ApiFailure) setFields(e.fields); }
    finally { lock.current = false; setBusy(false); }
  };
  const fieldError = (path: string) => fields.includes(path) ? <small className="live-error">Valor no válido.</small> : null;
  if (!loaded) return <><ErrorNotice error={error} /><p role="status">Abriendo borrador…</p></>;
  const s = input.settings;
  return <><Link to="/projects">← Proyectos</Link><h1>{record ? 'Configurar proyecto' : 'Nuevo proyecto'}</h1><ol className="wizard-steps" aria-label="Pasos">{['Origen', 'Contenido', 'Audiovisual', 'Producción', 'Confirmación'].map((name, i) => <li key={name} aria-current={step === i + 1 ? 'step' : undefined}>{i + 1}. {name}</li>)}</ol><section className="panel"><h2>Paso {step} de 5</h2><form className="live-form" onSubmit={(e) => { e.preventDefault(); void save(Math.min(5, step + 1), step === 5); }}>
    {step === 1 && <><label>Tipo de entrada<select value={input.inputType} onChange={(e) => edit({ ...input, inputType: inputTypeSchema.parse(e.target.value) })}>{inputTypeSchema.options.map((v) => <option key={v} value={v}>{labels[v]}</option>)}</select></label><label>Título<input value={input.title} maxLength={200} required onChange={(e) => edit({ ...input, title: e.target.value })} />{fieldError('title')}</label><label>{input.inputType === 'TOPIC' ? 'Tema y enfoque' : input.inputType === 'SCRIPT' ? 'Texto del guion' : 'Fuentes, enlaces y notas'}<textarea rows={8} required value={input.inputText} onChange={(e) => edit({ ...input, inputText: e.target.value })} />{fieldError('inputText')}</label><p>Máximo 1 MiB. Los enlaces se conservan como texto; no se descargan.</p></>}
    {step === 2 && <><label>Idioma<input value={s.language} required onChange={(e) => settings({ language: e.target.value })} />{fieldError('settings.language')}</label><label>Audiencia<input value={s.audience} maxLength={500} required onChange={(e) => settings({ audience: e.target.value })} />{fieldError('settings.audience')}</label><label>Duración objetivo (minutos)<input type="number" min={1} max={10000} step={1} list="durations" value={s.targetDurationMs / 60000 || ''} onChange={(e) => settings({ targetDurationMs: Number(e.target.value) * 60000 })} /><datalist id="durations"><option value="10" /><option value="15" /><option value="20" /></datalist>{fieldError('settings.targetDurationMs')}</label><p>Objetivo: video largo para YouTube.</p></>}
    {step === 3 && <><fieldset><legend>Estilo audiovisual · preset v1</legend><div className="live-options">{projectStyleSchema.options.map((v, i) => <label className="panel" key={v}><span className={`style-swatch style-${i}`} aria-hidden="true" /><input type="radio" name="style" checked={s.style === v} onChange={() => settings({ style: v })} />{labels[v]}</label>)}</div></fieldset><fieldset><legend>Modalidad · costo relativo estimado</legend>{modalitySchema.options.map((v) => <label key={v}><input type="radio" name="modality" checked={s.modality === v} onChange={() => settings({ modality: v })} />{labels[v]}</label>)}</fieldset><p>Comparación orientativa; no es una cotización ni activa proveedores.</p></>}
    {step === 4 && <><label>Modo<select value={s.mode} onChange={(e) => settings({ mode: productionModeSchema.parse(e.target.value) })}>{productionModeSchema.options.map((v) => <option key={v} value={v}>{labels[v]}</option>)}</select></label><p>{s.mode === 'AUTO' ? 'Avanzará sin checkpoints ordinarios cuando las integraciones estén disponibles.' : 'Esperará revisión en los checkpoints seleccionados.'} Errores y presupuesto bloquearán ambos modos.</p>{['SCRIPT', 'DIRECTION'].map((v) => <label key={v}><input type="checkbox" checked={s.checkpoints.includes(v)} onChange={(e) => settings({ checkpoints: e.target.checked ? [...s.checkpoints, v] : s.checkpoints.filter((x) => x !== v) })} />Revisar {v === 'SCRIPT' ? 'guion' : 'dirección'}</label>)}<PreferredProviderField value={s.providerPolicy.preferredIds} onChange={(ids) => settings({ providerPolicy: { ...s.providerPolicy, preferredIds: ids } })} /><label>Moneda<input value={s.budget.currency} maxLength={3} onChange={(e) => settings({ budget: { ...s.budget, currency: e.target.value.toUpperCase() } })} />{fieldError('settings.budget.currency')}</label><label>Presupuesto máximo (microunidades; 1 unidad = 1.000.000)<input type="number" min={0} step={1} value={s.budget.maxMicros} onChange={(e) => settings({ budget: { ...s.budget, maxMicros: Number(e.target.value) } })} />{fieldError('settings.budget.maxMicros')}</label><label><input type="checkbox" checked={s.providerPolicy.allowPaidFallback} onChange={(e) => settings({ providerPolicy: { ...s.providerPolicy, allowPaidFallback: e.target.checked } })} />Permitir proponer fallback de pago dentro del presupuesto</label><p>Guardar esta preferencia no autoriza gasto real.</p></>}
    {step === 5 && <><h3>{input.title}</h3><dl className="metadata"><div><dt>Entrada</dt><dd>{labels[input.inputType]}</dd></div><div><dt>Contenido</dt><dd>{s.language} · {s.audience} · {s.targetDurationMs / 60000} min</dd></div><div><dt>Dirección</dt><dd>{labels[s.style]} · {labels[s.modality]}</dd></div><div><dt>Producción</dt><dd>{labels[s.mode]} · {s.budget.maxMicros} microunidades {s.budget.currency}</dd></div></dl><p>Se guardará un borrador. Podrás iniciar su coordinación desde el proyecto. Las vías manuales requieren importar resultados incluso en modo Automático; revisa proveedor y agente antes de producir.</p></>}
    <ErrorNotice error={error} /><p role="status">{busy ? 'Guardando…' : dirty ? 'Cambios sin guardar' : record ? `Guardado · revisión ${record.revision}` : 'Borrador aún sin guardar'}</p><div className="live-actions"><Button type="button" variant="outline" disabled={busy || step === 1} onClick={() => void save(step - 1)}>Atrás</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void save(step)}>Guardar borrador</Button><Button type="submit" disabled={busy}>{step === 5 ? 'Confirmar y guardar proyecto' : 'Guardar y continuar'}</Button></div></form></section>{blocker.state === 'blocked' && <section className="panel" role="dialog" aria-modal="true" aria-labelledby="leave-title"><h2 id="leave-title">Hay cambios sin guardar</h2><Button onClick={() => blocker.reset()}>Seguir editando</Button><Button variant="outline" onClick={() => blocker.proceed()}>Salir sin guardar</Button></section>}</>;
}
