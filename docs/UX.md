# UX/UI — escritorio de producción

## Sistema visual
Interfaz oscura por defecto: fondo #09090B, superficie #121216, secundaria #18181D, bordes discretos, texto principal claro y secundario gris. Un acento (propuesto violeta #8B5CF6) para acciones y selección; estados con icono/texto además de color. Contraste AA, foco visible, navegación por teclado, tooltips accesibles. Layout desktop-first: sidebar plegable, cabecera con nombre y estado del agente, contenido con scroll y panel de detalle. En pantallas pequeñas permitir gestión y seguimiento; editor complejo puede requerir escritorio. Usar componentes shadcn adaptados, sin imitar logos ni interfaces propietarias.

## Rutas y vistas
| Ruta | Contenido y acción primaria |
|---|---|
| /login | Correo/contraseña; error genérico; cerrar sesión desde cabecera |
| /projects | Tarjetas o lista con thumbnail, estado, progreso, fecha; búsqueda/estado/orden, nuevo proyecto |
| /projects/new | Wizard: origen, contenido, audiovisual, modo/proveedores/presupuesto, confirmación |
| /projects/:id | Resumen del pipeline, progreso real, etapa/actividad, pausa/reanudar, alertas, escenas |
| /projects/:id/research | Notas, afirmaciones, fuentes y revisión |
| /projects/:id/script | Editor de guion, versión, duración aproximada, comparación/aprobación |
| /projects/:id/direction | Plan de escenas/tomas, especificaciones y checkpoint |
| /projects/:id/scenes | Lista ordenada con tiempo, estado, acciones por escena |
| /projects/:id/scenes/:sceneId | Preview, narración, voz, tomas, prompts, dirección, versiones; regeneración selectiva |
| /projects/:id/voice | Narración, segmentos y timings, importar/regenerar |
| /projects/:id/assets | Recursos del proyecto, importar, asignar y buscar existentes |
| /projects/:id/edit | Montaje declarativo: orden, duración, transiciones, audio, preview; no timeline NLE completo |
| /projects/:id/qa | Incidencias, gravedad, reparar/revisar, aprobar |
| /projects/:id/render | Perfil Full HD MP4, estimado, agente, iniciar/reintentar, salida |
| /projects/:id/youtube | Título, descripción, capítulos, tags e ideas thumbnail; copiar/exportar |
| /library | Recursos globales con filtros y metadatos |
| /generations | Generaciones y trabajos; proveedor, intento, error y recuperación |
| /providers | Capacidades, método, prioridad, disponibilidad, límites, credenciales protegidas |
| /settings | Agente, almacenamiento, render, IA, seguridad, presupuesto |

## Nuevo proyecto
Wizard guarda borrador en cada paso. 1: tipo de entrada, tema/título, texto de guion o fuentes. 2: idioma, audiencia, duración (10/15/20 min o custom), objetivo. 3: tarjetas con ejemplos visuales de estilos y modalidades; costo relativo claramente estimado. 4: automático/supervisado, checkpoints, proveedor preferido, presupuesto y política de fallback. 5: resumen, advertencias de disponibilidades y confirmación. Atrás no pierde datos. Iniciar es idempotente; doble click no duplica producción.

## Producción, editor y revisión
- Barra de etapas: pendiente, activa, lista, esperando revisión, fallida o invalidada; mostrar texto y no únicamente colores. Progreso indeterminado si no existe denominador; si se conoce, mostrar unidades completadas/total; nunca inventar %.
- Resumen: actividad reciente, job actual, proveedor, agente online, estimación y gasto observado. Polling con backoff/visibilidad, botón actualizar; no bloquear inputs mientras otra escena trabaja.
- Lista de escenas con orden, título, start/end calculados, miniatura, número de tomas e incidencias. Editor dividido en preview 16:9 y panel de propiedades; tabs narración, visual, audio, dirección y versiones.
- Regenerar: seleccionar componente (todo, imagen, video, visual, narración, voz, música/ambiente, montaje), instrucción opcional, impacto, proveedor, costo estimado y confirmar. Mostrar versión candidata, anterior activa, comparación y acción usar versión; cancelar no elimina historial.
- Checkpoints supervisados: después de guion y dirección antes de generación costosa; antes de render si QA requiere decisión. Aprobar con versión exacta, editar o regenerar. Si cambió la versión mientras estaba abierta, refrescar antes de aprobar.
- Fallo: mensaje útil y código/ID de diagnóstico (sin secretos), reintentar si permitido, cambiar proveedor compatible con confirmación de gasto, importar manualmente. Agente desconectado: mostrar trabajos en espera con explicación, no marcar fracaso inmediato.
- Exportación: validar QA/manifest, escoger Full HD, render local, progreso, reproducir archivo si disponible, descargar cuando existe copia remota autorizada; abrir carpeta requiere acción del agente compatible/confirmada. Paquete YouTube se genera con timeline de render elegido.

## Estados transversales y aceptación visual
Cada ruta necesita loading/skeleton, vacío con CTA, error recuperable, acceso denegado/404 y datos válidos. Deshabilitar acción por motivo explícito; proteger navegación con cambios sin guardar. Formularios Zod con errores por campo. Acciones caras/destructivas requieren confirmación. Nunca mostrar secretos completos. Usar toasts para resultados y alertas persistentes para bloqueo. Validar con datos simulados de 20+ escenas, listas paginadas y offline/reconexión.
