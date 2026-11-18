import { AgentStatus } from './agents';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Circle, Clapperboard, Clock3, Film, FolderOpen, Layers3, LayoutGrid, Library, LockKeyhole, Monitor, PanelLeftClose, PanelLeftOpen, Play, Plus, Search, Settings2, SlidersHorizontal, Sparkles, Unplug, WandSparkles, WifiOff } from 'lucide-react';
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Button } from './components/ui/button';
import { DemoStateControl, EmptyState, NotFound, ViewState } from './components/view-state';
import { projects, projectSections, sceneFixtures, timecode } from './fixtures';
import type { ProjectFixture } from './fixtures';

const navigation = [
  { path: '/projects', label: 'Proyectos', icon: LayoutGrid },
  { path: '/library', label: 'Biblioteca', icon: Library },
  { path: '/generations', label: 'Generaciones', icon: Layers3 },
  { path: '/providers', label: 'Proveedores', icon: WandSparkles },
  { path: '/settings', label: 'Configuración', icon: Settings2 },
];

function SidebarLink({ item, showCount = true }: { item: (typeof navigation)[number]; showCount?: boolean }) {
  const [showTip, setShowTip] = useState(false);
  const Icon = item.icon;
  const tooltipId = `nav-tip-${item.path.slice(1)}`;
  return <NavLink to={item.path} aria-label={item.label} aria-describedby={showTip ? tooltipId : undefined}
    onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)}
    onFocus={() => setShowTip(true)} onBlur={() => setShowTip(false)}
    onKeyDown={(event) => { if (event.key === 'Escape') setShowTip(false); }}>
    <Icon /><span className="sidebar-label">{item.label}</span>
    {showCount && item.path === '/projects' && <span className="nav-count sidebar-label">{projects.length}</span>}
    <span id={tooltipId} role="tooltip" className="nav-tooltip" hidden={!showTip}>{item.label}</span>
  </NavLink>;
}

function Status({ label, tone = 'neutral' }: { label: string; tone?: string }) {
  return <span className={`status-badge ${tone}`}>{tone === 'green' ? <Check /> : <Circle />}{label}</span>;
}

function Poster({ project, small = false }: { project: ProjectFixture; small?: boolean }) {
  return <div className={`poster ${project.theme} ${small ? 'poster-small' : ''}`} aria-hidden="true"><span className="poster-orbit" /><span className="poster-land" /><span className="poster-grain" />{!small && <><span className="poster-caption">VIDEO STUDIO<span>HISTORIAS POR CONTAR</span></span><span className="poster-duration"><Clock3 />{project.minutes} min</span><span className="poster-mark"><Play /></span></>}</div>;
}

export function Shell({ identity, onLogout }: { identity?: string; onLogout?: () => void } = {}) {
  const privateMode = identity !== undefined;
  const [collapsed, setCollapsed] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const location = useLocation();
  const content = useRef<HTMLElement>(null);
  const title = location.pathname === '/login' ? 'Acceso privado' : location.pathname.startsWith('/scenes/') ? 'Editor de escena' : navigation.find((item) => location.pathname.startsWith(item.path))?.label ?? 'Página no encontrada';
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    document.title = `Video Studio · ${title}`;
    content.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname, title]);

  return <div className={`studio-shell ${collapsed ? 'is-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content">Saltar al contenido</a>
    <aside className="sidebar" aria-label="Barra lateral">
      <Link to="/projects" className="brand" aria-label="Video Studio, proyectos"><span className="brand-symbol"><Clapperboard /></span><span className="sidebar-label"><strong>video<span>studio</span></strong><small>ESPACIO DE PRODUCCIÓN</small></span></Link>
      <div className="nav-caption sidebar-label">ESPACIO DE TRABAJO</div>
      <nav aria-label="Navegación principal">{navigation.map((item) => <SidebarLink key={item.path} item={item} showCount={!privateMode} />)}</nav>
      <div className="sidebar-bottom"><div className="agent-card sidebar-label"><span className="agent-card-icon"><Monitor /></span><strong>Tu estudio, en local</strong><p>El agente de producción aún no está conectado.</p><Link to="/settings">Ver configuración<ArrowRight /></Link></div>{privateMode ? <div className="private-link"><span className="avatar">VS</span><span className="sidebar-label"><strong>{identity}</strong><small>Sesión privada</small></span></div> : <Link className="private-link" to="/login" aria-label="Acceso privado"><span className="avatar">VS</span><span className="sidebar-label"><strong>Espacio privado</strong><small>Vista de demostración</small></span><LockKeyhole className="sidebar-label" /></Link>}</div>
    </aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumbs"><Button variant="ghost" size="icon" className="collapse-button" aria-label={collapsed ? 'Expandir navegación' : 'Plegar navegación'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button><span>Espacio de trabajo</span><ChevronRight /><strong>{title}</strong></div><Link className="agent-status" to="/settings"><span className="connection-dot" />{privateMode ? <AgentStatus /> : 'Agente sin conectar'}<ChevronRight /></Link>{privateMode && <Button variant="outline" onClick={onLogout}>Cerrar sesión</Button>}</header>
      <div className="workspace-content">{!privateMode && <DemoStateControl />}{!online && <div role="alert" className="offline-banner"><WifiOff />{privateMode ? 'Sin conexión. Conserva tus cambios y reintenta el guardado al reconectar.' : 'Sin conexión. Puedes seguir explorando los datos de muestra; no se enviarán cambios.'}</div>}<main ref={content} id="main-content" tabIndex={-1}>{privateMode ? <Outlet /> : <ViewState><Outlet /></ViewState>}</main><footer className="workspace-footer"><span>VIDEO STUDIO</span><span>Un espacio para historias que importan.</span><span>{privateMode ? 'Espacio privado' : 'Demostración local'}</span></footer></div>
    </div>
  </div>;
}

function Projects() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const filter = params.get('status') ?? 'Todos';
  const sort = params.get('sort') ?? 'recent';
  const update = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); setParams(next, { replace: true }); };
  const visible = projects.filter((project) => project.title.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')) && (filter === 'Todos' || project.label === filter)).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'es') : b.updated.localeCompare(a.updated));

  return <><div className="page-heading"><div><span className="eyebrow">TU ESPACIO CREATIVO</span><h1>Proyectos<span className="heading-dot">.</span></h1><p>Cada gran historia empieza con una idea.</p></div><Button asChild><Link to="/projects/new"><Plus />Nuevo proyecto</Link></Button></div>
    <section className="summary-strip" aria-label="Resumen de proyectos de muestra"><div><span className="summary-icon"><FolderOpen /></span><span><strong>04</strong><small>Proyectos</small></span></div><div><span className="summary-icon violet"><Film /></span><span><strong>01</strong><small>En producción</small></span></div><div><span className="summary-icon amber"><BookOpen /></span><span><strong>01</strong><small>En revisión</small></span></div><p><Sparkles />Tu próxima historia<br /><span>está por comenzar.</span></p></section>
    <div className="collection-heading"><h2>Tu colección<span>{projects.length}</span></h2><span>DATOS DE MUESTRA</span></div>
    <div className="filters"><label className="search-field"><Search /><span className="sr-only">Buscar proyectos</span><input type="search" placeholder="Buscar un proyecto…" value={query} onChange={(event) => update('q', event.target.value)} /></label><label className="filter-select"><SlidersHorizontal /><span className="sr-only">Filtrar por estado</span><select aria-label="Filtrar por estado" value={filter} onChange={(event) => update('status', event.target.value)}>{['Todos', 'En producción', 'En revisión', 'Borrador', 'Finalizado'].map((status) => <option value={status} key={status}>{status === 'Todos' ? 'Todos los estados' : status}</option>)}</select></label><label className="filter-select"><ArrowDownUp /><span className="sr-only">Ordenar proyectos</span><select aria-label="Ordenar proyectos" value={sort} onChange={(event) => update('sort', event.target.value)}><option value="recent">Más recientes</option><option value="name">Nombre A–Z</option></select></label></div>
    <p className="sr-only" role="status">{visible.length} proyectos encontrados</p>
    {visible.length ? <section className="project-grid" aria-label="Proyectos de muestra">{visible.map((project) => <Link key={project.id} to={`/projects/${project.id}`} className="project-card" aria-label={`Abrir ${project.title}`}><Poster project={project} /><div className="project-card-body"><div className="project-card-meta"><Status label={project.label} tone={project.tone} /><span>{project.mode}</span></div><h3>{project.title}</h3><p>{project.subtitle}</p><div className="project-category"><span>{project.category}</span><span>ES</span></div><div className="project-progress"><span>{project.total ? `${project.completed} de ${project.total} escenas listas` : 'Aún sin planificación de escenas'}</span>{project.total > 0 && <progress max={project.total} value={project.completed} aria-label={`Escenas listas de ${project.title}`} />}</div><div className="project-card-footer"><span>Actualizado {project.updated.slice(8)}/{project.updated.slice(5, 7)}</span><span>Abrir proyecto<ArrowRight /></span></div></div></Link>)}</section> : <div className="empty-state"><span className="state-icon"><Search /></span><h2>No hay proyectos con estos filtros</h2><p>Prueba con otro título o restablece los filtros.</p><Button variant="outline" onClick={() => setParams({})}>Limpiar filtros</Button></div>}
    <div className="quiet-note"><LockKeyhole /><span>Tus historias tienen su propio espacio. Esta demostración no guarda cambios ni inicia producciones.</span></div>
  </>;
}

function ProjectLayout() {
  const { id } = useParams();
  const project = projects.find((item) => item.id === id);
  if (!project) return <NotFound />;
  return <><Link className="back-link" to="/projects"><ArrowLeft />Todos los proyectos</Link><div className="page-heading project-heading"><div><span className="eyebrow">PROYECTO DE MUESTRA · {project.category.toLocaleUpperCase('es')}</span><h1>{project.title}</h1><p>{project.minutes} min objetivo <span>·</span> Español <span>·</span> {project.mode}</p></div><Status label={project.label} tone={project.tone} /></div><nav className="project-tabs" aria-label="Secciones del proyecto">{projectSections.map((section) => <NavLink key={section.path} end to={`/projects/${project.id}${section.path ? `/${section.path}` : ''}`}>{section.label}</NavLink>)}</nav><Outlet context={project} /></>;
}

function Overview() {
  const project = useOutletContext<ProjectFixture>();
  const readyStages = project.label === 'Finalizado' ? 6 : project.total > 0 ? 2 : 0;
  const currentStage = project.total > 0 && project.label !== 'Finalizado' ? 2 : -1;
  return <><div className="detail-grid"><section className="panel"><div className="section-title"><h2>Una historia en movimiento</h2><Film /></div><Poster project={project} /><p className="panel-copy">{project.subtitle} El avance que ves es una muestra; no hay trabajos ejecutándose.</p><div className="pipeline" aria-label="Etapas de muestra">{['Investigación', 'Guion', 'Dirección', 'Recursos', 'Montaje', 'Render'].map((stage, index) => <div key={stage} className={index < readyStages ? 'complete' : index === currentStage ? 'current' : ''}>{index < readyStages ? <Check /> : <Circle />}<strong>{stage}</strong><small>{index < readyStages ? 'Lista' : index === currentStage ? 'En revisión' : 'Pendiente'}</small></div>)}</div></section><aside className="panel"><div className="section-title"><h2>{project.label === 'Finalizado' ? 'Historia completada' : 'Próximo paso'}</h2><Clock3 /></div><Status label={project.label === 'Finalizado' ? 'Completado · muestra' : project.total ? 'Esperando revisión · muestra' : 'Borrador · muestra'} tone={project.tone} /><h3>Dar forma a cada escena</h3><p>Explora la planificación de muestra antes de continuar con la historia.</p><Button asChild variant="outline"><Link to={`/projects/${project.id}/scenes`}>Explorar escenas<ArrowRight /></Link></Button><div className="agent-block"><Unplug /><strong>Agente sin conectar</strong><p>La producción local estará disponible cuando conectes y configures tu agente.</p></div><Button disabled aria-describedby="production-unavailable">Iniciar producción</Button><p id="production-unavailable" className="disabled-reason">No disponible: esta demostración solo permite explorar.</p></aside></div></>;
}

function Scenes() {
  const project = useOutletContext<ProjectFixture>();
  const [params, setParams] = useSearchParams();
  const scenes = sceneFixtures(project.total, project.completed);
  const pageCount = Math.max(1, Math.ceil(scenes.length / 6));
  const requestedPage = Number(params.get('page') ?? '1');
  const page = Number.isInteger(requestedPage) ? Math.min(pageCount, Math.max(1, requestedPage)) : 1;
  const move = (value: number) => { const next = new URLSearchParams(params); next.set('page', String(value)); setParams(next); };
  if (!scenes.length) return <EmptyState title="Aún no hay escenas" description="Este borrador de muestra todavía no tiene planificación audiovisual." />;
  return <section className="panel scenes-panel"><div className="section-title"><div><h2>Escenas de la historia</h2><p>{scenes.length} escenas de muestra · tiempos sintéticos de 30 s</p></div><Status label="Plan de muestra" /></div><ol className="scene-list" start={(page - 1) * 6 + 1}>{scenes.slice((page - 1) * 6, page * 6).map((scene) => <li key={scene.id}><Link to={`/projects/${project.id}/scenes/${scene.id}`}><span className="scene-number">{String(scene.number).padStart(2, '0')}</span><span className={`scene-thumb ${project.theme}`}><Film /></span><span className="scene-title"><strong>{scene.title}</strong><small>{timecode(scene.start)} — {timecode(scene.end)} <span>·</span> {scene.shots} tomas</small></span><Status label={scene.label} tone={scene.tone} /><ChevronRight /></Link></li>)}</ol><div className="pagination"><span role="status">Página {page} de {pageCount}</span><div><Button size="sm" variant="outline" disabled={page === 1} onClick={() => move(page - 1)} aria-label="Página anterior"><ChevronLeft />Anterior</Button><Button size="sm" variant="outline" disabled={page === pageCount} onClick={() => move(page + 1)} aria-label="Página siguiente">Siguiente<ChevronRight /></Button></div></div></section>;
}

function SceneDetail() {
  const project = useOutletContext<ProjectFixture>();
  const { sceneId } = useParams();
  const scene = sceneFixtures(project.total, project.completed).find((item) => item.id === sceneId);
  if (!scene) return <NotFound />;
  return <><Link className="back-link" to={`/projects/${project.id}/scenes`}>← Volver a escenas</Link><div className="section-title"><h2>Escena {String(scene.number).padStart(2, '0')} · {scene.title}</h2><Status label={scene.label} tone={scene.tone} /></div><div className="detail-grid"><section className="panel"><Poster project={project} /><p className="preview-label">Previsualización ilustrativa · no es un recurso generado</p></section><section className="panel"><span className="eyebrow">PLANIFICACIÓN DE MUESTRA</span><h2>Narración y visual</h2><p>Un recorrido pausado revela los detalles de este mundo. La cámara acompaña el relato con movimientos suaves y un ambiente inmersivo.</p><dl className="metadata"><div><dt>Tiempo</dt><dd>{timecode(scene.start)} — {timecode(scene.end)}</dd></div><div><dt>Tomas</dt><dd>{scene.shots}</dd></div><div><dt>Versión</dt><dd>Muestra, sin historial real</dd></div></dl><Button disabled aria-describedby="scene-unavailable">Editar o regenerar</Button><p className="disabled-reason" id="scene-unavailable">No disponible: el editor y la generación se incorporarán después.</p></section></div></>;
}

function PendingView({ title, description, action = 'Editar contenido' }: { title: string; description: string; action?: string }) {
  return <section className="panel pending-view"><span className="state-icon"><Clapperboard /></span><span className="eyebrow">VISTA PREPARADA</span><h2>{title}</h2><p>{description}</p><div className="pending-divider" /><p className="pending-message">Esta sección todavía no permite cambios. Puedes recorrer las vistas y explorar los datos de muestra.</p><Button disabled aria-describedby="pending-reason">{action}</Button><p id="pending-reason" className="disabled-reason">Acción no disponible en esta demostración.</p></section>;
}

function LibraryView() {
  return <><PageHeading title="Biblioteca" description="Un lugar para los recursos de cada historia." /><div className="asset-grid">{['Imagen · Paisaje submarino', 'Audio · Ambiente de bosque', 'Video · Ciudad nocturna'].map((name, index) => <article className="panel asset-card" key={name}><div className={`asset-preview ${['ocean', 'forest', 'city'][index]}`}><Film /></div><Status label="Muestra ilustrativa" /><h2>{name}</h2><p>Sin archivo multimedia adjunto. Origen y licencia pendientes de importación.</p></article>)}</div><div className="quiet-note"><Library />La importación y reutilización de recursos aún no están disponibles.</div></>;
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return <div className="page-heading"><div><span className="eyebrow">ESPACIO DE TRABAJO</span><h1>{title}<span className="heading-dot">.</span></h1><p>{description}</p></div></div>;
}

function GenerationsView() {
  return <><PageHeading title="Generaciones" description="Cada trabajo, su estado y su siguiente paso." /><section className="panel"><div className="section-title"><h2>Actividad de muestra</h2><Status label="Sin trabajos reales" /></div>{[['Plan audiovisual', 'Esperando revisión', 'amber'], ['Investigación', 'Completada · muestra', 'green'], ['Render local', 'Esperando agente', 'neutral']].map(([title, label, tone]) => <div className="activity-row" key={title}><span className="activity-icon"><Layers3 /></span><span><strong>{title}</strong><small>El silencio de los océanos · datos de muestra</small></span><Status label={label ?? ''} tone={tone ?? 'neutral'} /></div>)}</section></>;
}

function ProvidersView() {
  return <><PageHeading title="Proveedores" description="Capacidades claras. Costos bajo tu control." /><section className="panel"><div className="section-title"><h2>Métodos de producción</h2><Status label="Sin conexiones" /></div>{['Texto e investigación', 'Voz y narración', 'Imagen y video'].map((label) => <div className="activity-row" key={label}><span className="activity-icon"><WandSparkles /></span><span><strong>{label}</strong><small>Importación manual prevista · ninguna API de pago autorizada</small></span><Status label="Por configurar" /></div>)}<p className="panel-copy">Esta vista no guarda credenciales ni activa proveedores. La configuración estará disponible en una etapa posterior.</p></section></>;
}

function SettingsView() {
  return <><PageHeading title="Configuración" description="Tu espacio de producción, a tu manera." /><div className="settings-grid">{[{ title: 'Agente local', icon: Monitor, text: 'Sin conectar. No hay producción ni render en ejecución.' }, { title: 'Almacenamiento', icon: FolderOpen, text: 'Sin configurar. Esta demostración no sube ni guarda archivos.' }, { title: 'Seguridad', icon: LockKeyhole, text: 'Autenticación pendiente. Se muestran únicamente datos ficticios.' }, { title: 'Presupuesto', icon: SlidersHorizontal, text: 'Sin gasto autorizado. No hay integraciones de pago activas.' }].map(({ title, icon: Icon, text }) => <section className="panel settings-card" key={title}><Icon /><h2>{title}</h2><p>{text}</p></section>)}</div></>;
}

export function App() {
  return <Routes><Route element={<Shell />}><Route index element={<Navigate to="/projects" replace />} /><Route path="projects" element={<Projects />} /><Route path="projects/new" element={<><PageHeading title="Nuevo proyecto" description="Dale un espacio a tu próxima historia." /><section className="wizard-steps" aria-label="Pasos previstos del nuevo proyecto">{['Origen', 'Contenido', 'Audiovisual', 'Producción', 'Confirmación'].map((step, index) => <div key={step}><span>{index + 1}</span>{step}</div>)}</section><PendingView title="Toda historia empieza aquí" description="Podrás partir de un tema, un guion propio o tus fuentes. El asistente de creación todavía no guarda borradores." action="Crear proyecto" /></>} /><Route path="projects/:id" element={<ProjectLayout />}><Route index element={<Overview />} /><Route path="scenes" element={<Scenes />} /><Route path="scenes/:sceneId" element={<SceneDetail />} />{projectSections.filter((section) => section.path && section.path !== 'scenes').map((section) => <Route key={section.path} path={section.path} element={<PendingView title={section.label} description={section.description} action={section.path === 'render' ? 'Iniciar render' : 'Editar contenido'} />} />)}</Route><Route path="library" element={<LibraryView />} /><Route path="generations" element={<GenerationsView />} /><Route path="providers" element={<ProvidersView />} /><Route path="settings" element={<SettingsView />} /><Route path="login" element={<PendingView title="Acceso privado" description="El acceso seguro estará disponible en una próxima etapa. Esta demostración no inicia sesiones ni solicita credenciales." action="Iniciar sesión" />} /><Route path="*" element={<NotFound />} /></Route></Routes>;
}
