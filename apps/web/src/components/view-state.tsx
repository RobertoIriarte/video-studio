import type { ReactNode } from 'react';
import { AlertCircle, ArrowLeft, FolderOpen, LockKeyhole, SearchX } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from './ui/button';

export function EmptyState({ title = 'Todavía no hay contenido', description = 'Explora el proyecto de muestra para conocer este espacio.' }: { title?: string; description?: string }) {
  return <div className="empty-state"><span className="state-icon"><FolderOpen /></span><h2>{title}</h2><p>{description}</p><Button asChild variant="outline"><Link to="/projects/oceanos">Explorar proyecto de muestra</Link></Button></div>;
}

export function NotFound() {
  return <div className="empty-state"><span className="state-icon"><SearchX /></span><span className="eyebrow">404 · NO ENCONTRADO</span><h1>No encontramos esta página</h1><p>La dirección no existe o el recurso no está disponible en esta demostración.</p><Button asChild variant="outline"><Link to="/projects"><ArrowLeft />Volver a proyectos</Link></Button></div>;
}

export function ViewState({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const state = params.get('view') ?? 'ready';
  const reset = () => { const next = new URLSearchParams(params); next.delete('view'); setParams(next, { replace: true }); };
  if (state === 'loading') return <section className="skeleton-grid" role="status" aria-label="Cargando contenido" aria-busy="true"><span className="sr-only">Cargando contenido de muestra</span>{[0, 1, 2, 3].map((key) => <div className="skeleton-card" key={key}><div /><span /><span /></div>)}</section>;
  if (state === 'empty') return <EmptyState />;
  if (state === 'error') return <section className="empty-state" role="alert"><span className="state-icon error"><AlertCircle /></span><h2>No pudimos cargar el contenido</h2><p>Es un error simulado. Puedes volver a intentarlo sin perder tus filtros.</p><p className="diagnostic">DEMO_LOAD_ERROR · demo-request-01</p><Button onClick={reset}>Reintentar</Button></section>;
  if (state === 'denied') return <section className="empty-state"><span className="state-icon"><LockKeyhole /></span><h2>Acceso no disponible</h2><p>Esta vista simula un acceso denegado. No modifica permisos ni inicia sesión.</p><Button variant="outline" onClick={reset}>Volver a la muestra</Button></section>;
  if (state === 'notfound') return <NotFound />;
  return children;
}

export function DemoStateControl() {
  const [params, setParams] = useSearchParams();
  return <div className="demo-bar"><span><i />Datos de muestra<span className="demo-explanation"> · sin conexión a producción</span></span><label>Estado de vista<select aria-label="Estado de vista" value={params.get('view') ?? 'ready'} onChange={(event) => { const next = new URLSearchParams(params); next.set('view', event.target.value); setParams(next); }}><option value="ready">Con datos</option><option value="loading">Cargando</option><option value="empty">Vacío</option><option value="error">Error</option><option value="denied">Acceso denegado</option><option value="notfound">No encontrado</option></select></label></div>;
}
