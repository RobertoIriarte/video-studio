# Especificación funcional MVP

## Objetivo y público
Herramienta privada para producir videos largos de YouTube, ahorrar tiempo, mantener calidad narrativa y audiovisual y controlar el gasto. Usuario propietario de proyectos. No se garantiza aceptación del programa de monetización ni ingresos; evitar material repetitivo, derechos dudosos y afirmaciones sin fuentes.

## Flujo principal
Crear proyecto desde tema (texto), guion propio (texto/archivo compatible) o fuentes/referencias (texto/URLs permitidas). Configurar idioma, audiencia, objetivo, título, duración objetivo, estilo, modalidad, modo de producción, límites y políticas de proveedor. Guardar borrador editable. Confirmar plan/costo antes de iniciar. Investigación → guion → dirección → voz → sincronización → recursos → montaje → QA → render → paquete YouTube. El DAG permite paralelismo y checkpoints configurados.

## Requisitos identificados
| ID | Requisito | Aceptación |
|---|---|---|
| FR01 | Crear/listar/editar proyectos | 3 clases de entrada válidas; guardar y volver a abrir borrador |
| FR02 | Estilos documental cinematográfico, realista premium, terror/misterio | Presets versionados visibles y aplicados al plan |
| FR03 | Modalidades imágenes dinámicas, híbrida, cinematográfica y explicativa | La dirección usa política correspondiente y muestra costo relativo estimado |
| FR04 | Automático y supervisado; acciones manuales en ambos | Automático avanza sin checkpoints ordinarios; supervisado espera aprobaciones; errores/budget bloquean ambos |
| FR05 | Investigación con fuentes, notas, incertidumbre | Afirmaciones trazables; sin inventar referencias; importar fuentes propias |
| FR06 | Guion narrativo versionado | Estructura, hook, desarrollo, cierre; edición y regeneración; idioma y duración aproximada |
| FR07 | Dirección audiovisual | Escenas, tomas, prompts, cámara, continuidad, transiciones, audio/ambiente, texto/gráficos cuando aplique |
| FR08 | Voz y sincronización | Archivo de narración, marcas temporales por segmento, duraciones reales; ajustar plan a audio |
| FR09 | Recursos | Texto-imagen, imagen-video, texto-video, fotogramas inicial/final según capacidad, stock, gráficos programáticos; fallback manual |
| FR10 | Editor de escenas | Preview, narración, tomas, audio, dirección; regenerar todo o componente seleccionado, comparar y activar versión |
| FR11 | Biblioteca | Filtros por tipo/proyecto, preview, origen, licencia, prompt, costo, duración, resolución; reutilización autorizada |
| FR12 | Trabajos persistentes | Estado, progreso, agente, subtarea, errores, pausa/reanudación/reintento; recuperar tras cierre del navegador |
| FR13 | Gestión proveedores | Capacidades declaradas, prioridad, estado, costo, límites, fallback explícito, método de integración |
| FR14 | QA | Incidencias por escena/componente, severidad, propuesta de reparación, reporte de aprobación |
| FR15 | Render local | MP4 1920x1080, preview, progreso y descarga o carpeta local disponible |
| FR16 | Paquete YouTube | Título, descripción, capítulos basados en timeline final, tags, propuestas de miniatura; copiar/exportar |
| FR17 | Agente local | Registro, estado online/offline, espacio, FFmpeg/Remotion, trabajos, diagnóstico |
| FR18 | Seguridad y costos | Aislamiento, límites, registros e imports validados; sin fallback pago no autorizado |

## Reglas de negocio
- Duración objetivo orientativa; duración final determinada por narración y montaje. No estirar clips de manera automática si degrada calidad sin criterio de dirección.
- Manual es intervención selectiva, no un tercer pipeline independiente. Automático no significa ignorar permisos, errores, presupuesto o QA crítico.
- Un proyecto puede contener muchas escenas; una escena contiene varias tomas; los recursos se referencian, no se copian innecesariamente.
- Una generación nunca reemplaza la versión activa en silencio. En automático puede activarse tras validación conforme a su política; en supervisado requiere revisión en el checkpoint correspondiente.
- Cambiar guion invalida las dependencias afectadas (voz, timings, recursos si semántica cambia, montaje, QA, render, capítulos). Conservar versiones anteriores. Mostrar impacto antes de confirmar cambios.
- No publicar automáticamente en YouTube, no incluir editor NLE completo, marketplace, multiusuario colaborativo, video 4K, gestión canales, thumbnail generativa obligatoria ni analítica de viralidad en MVP.

## Requisitos no funcionales
Privacidad por defecto; carga de UI rápida con paginación y previews; interfaz en español; estados comprensibles; control por teclado y foco visible; reanudación sin pérdida de trabajo confirmado; artifact checksums; logs correlacionados sin secretos; límites y costos visibles. La calidad y duración deben verificarse con un video corto y posteriormente uno largo representativo antes de declarar listo.
