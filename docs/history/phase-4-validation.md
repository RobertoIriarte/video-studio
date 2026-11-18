# Fase 4 — evidencia local

Alcance autorizado: F4-01 a F4-04. Sin proveedores reales, créditos, deploy, commit ni push. Se preservan los cambios locales de F3.

## F4-01

- Contratos JSON v1 de research/script, metadatos de modelo/prompt/simulación, claims enlazados a fuentes y reparación estructural limitada a un intento. JSON máximo 256 KiB.
- Mock determinista sin red: conserva URLs aportadas, no las consulta ni las presenta como verificadas; no inventa afirmaciones. El guion propio conserva sus palabras y señala los límites de la simulación.
- Publicación de candidato, fencing, intento, reserva, checkpoint y activación AUTO en un batch D1. Lease vencido no deja candidato ni checkpoint. Salidas/modelo/prompt en catálogo privado; input hash e intentos en jobs.
- `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test` (180/180), `pnpm.cmd build`: pasaron. Cuatro pruebas nuevas en `tests/content-agents.test.ts` con D1 nativo efímero. Build mantiene advertencia de tamaño de chunk, sin error.

## Dirección: decisiones de implementación

- Checkpoint DIRECTION por versión de escena, coherente con la FK existente. Todas las escenas requieren su revisión en SUPERVISED; no hay recursos multimedia producidos.
- Una sección narrativa se convierte en escena con varias tomas. Los mocks dividen el guion en secciones; una escena >128 s se rechaza para solicitar división, sin estirar clips. Objetivo orientativo hasta voz real en F5.
- `content_expansions` registra fanout completado; claves deterministas por padre/sección permiten recuperar un corte durante la planificación sin duplicar jobs. Solo mocks internos explícitos; la configuración normal continúa manual.

## Límites

No importación de archivos, agente, voz, render ni adaptadores reales: fases F5/F6. El coordinador mantiene invocación de servidor acotada y no depende de polling web; no se configuró cron cloud. No hay nueva cuenta real ni material privado de usuario en fixtures.

## F4-02

`pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd build` y 8/8 pruebas focalizadas research/director pasaron. Cuatro pruebas nuevas: suma entera y límites de tomas, modalidades/presets, conservación de palabras de guion propio, fanout concurrente y checkpoint DIRECTION con D1 nativo. El fanout se limita a tres escenas nuevas por invocación y persiste su finalización; las siguientes invocaciones retoman las restantes.

## F4-03

Edición privada research/script/scene, candidatas inmutables, activación explícita, comparación y paginación. Recibos y CAS de proyecto en el mismo batch que contenido/hijos/auditoría. Parent y revisión de escena se verifican también dentro del UPDATE condicional. Investigación guarda URLs/notas/claims sin descarga; textos se representan como datos React, sin HTML ejecutable.

Cuatro pruebas nuevas D1/API pasaron; lint/types/build pasaron. E2E completo 27/27 pasó, incluyendo nuevo flujo con 26 escenas, teclado/ESC, bloqueo de navegación sin guardar, edición, activación, recarga, axe A/AA y móvil 390 px. Capturas inspeccionadas: `test-results/content-editor.png` y `content-editor-mobile.png` (ignoradas). Durante implementación el E2E encontró etiquetas de textarea ambiguas y una pérdida de acentos al editar por pipe de PowerShell; se corrigieron en el producto con nombres accesibles explícitos y UTF-8. No se omitió la comprobación.

## F4-04

Cinco pruebas nuevas nativas pasaron: política pura, VISUAL incluso en AUTO, NARRATION, MUSIC/UNKNOWN y sustitución global de guion. Se conserva la activa mientras se prepara candidata. Voz/música/ambiente compatibles conservan enlaces y elegibilidad tras SUPERSEDED; otro componente o escena no se invalida por defecto. Compatibilidad se prueba por versión/job scoped y hash original. Cambiar narración quita voz/visual incompatibles de la candidata, conserva recursos anteriores y planifica dirección/voz/visual de forma recuperable. Música/ambiente/montaje no producen archivos inventados.

La prueba visual usa tres assets de audio sintéticos MISSING (solo metadatos) y un job de render histórico sintético SUCCEEDED con snapshot/intento. Tras activar, conserva payload, hash y resultado histórico; no ejecuta FFmpeg ni declara MP4 integrado. Nueva regeneración deja un proyecto COMPLETED en RUNNING. Reserva con posible efecto externo pasa a UNKNOWN y revoca el lease; solo un rechazo verificado libera la reserva y termina STALE cuando los inputs ya no son vigentes. Followups se crean una sola vez y usan fence del puntero activo al insertarse.

E2E ampliado pasó 27/27: impacto por scope, ESC sin efecto, VOICE en WAITING_MANUAL, respuesta POST perdida tras aceptación y retry con misma clave/body sin duplicación, activación de guion con escenas existentes y conservación de versiones INVALIDATED. La prueba focal del editor volvió a pasar 1/1 después de aislar borradores por ruta/ID y corregir comparación contra la base seleccionada. Los diálogos congelan ID y revisión, sin reemplazar en silencio la versión revisada al recibir polling.

## Cierre y operación

- `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test` **193/193 en 22 archivos**, `pnpm.cmd build`: pasaron. Se agregaron 17 pruebas sobre F3 (176); una prueba E2E nueva sobre las 26 anteriores, ampliada para F4-04.
- Focalizadas finales de regeneración/editor **9/9** después de comprobar reapertura del proyecto completado; API dry-run/types pasaron. Bundle web ~530 kB (~162 kB gzip) mantiene advertencia no bloqueante; no se alteró su umbral.
- Editor D1/API **4/4** y lint volvieron a pasar tras limitar referencias SQL; build web/tipos y E2E focal **1/1** pasaron con borradores aislados por ruta. La suite ampliada completa **27/27** había pasado con todas las operaciones F4. El aviso Windows WSASend apareció al abortar intencionalmente una respuesta perdida; no falló la suite.
- `pnpm.cmd db:migrate:local` pasó hasta **0117**; reaplicación: sin pendientes. Consulta agregada local: 117 migraciones, users/projects/jobs/usage_records **0**. No se creó una cuenta real ni se sembraron fixtures en desarrollo.
- Diff/whitespace revisados también para archivos nuevos, paths candidatos y patrones comunes de secretos sin hallazgos. Se conservan los cambios previos de F3. Sin commit/push, CI alojada/Linux, despliegue ni recursos/costos externos. Demo previa de 5173 se conserva; servidores E2E son efímeros.
- Límite secundario: máximo 64 assets distintos referenciados por una versión de escena, validado antes del SQL; refs/frame IDs deben pertenecer al proyecto y ser visuales, start/end frame de tipo IMAGE.
- F5-01 sigue sin iniciar. El render binario, importación R2/local, agente y proveedores reales mantienen sus fases. Cron cloud, límites CPU/SDK y CI alojada continúan pendientes de validación según DECISIONS.
