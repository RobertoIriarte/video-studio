# Estrategia de pruebas y aceptación

## Herramientas propuestas
Vitest unit/integration, Playwright E2E de web, pruebas de Worker/D1 locales compatibles con runtime y mocks HTTP. Verificar versiones y compatibilidad antes de fijar dependencias. Fixtures sintéticas pequeñas; sin acceso a producción ni red/IA paga por defecto. Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; `pnpm test:e2e` en fases con UI; indicar comandos reales y salidas resumidas en STATUS. CI reproduce instalación congelada y validaciones. Tests deterministas con reloj falso, IDs/semillas y provider fake; no depender de sleeps reales.

## Matriz de pruebas obligatorias

F3: `orchestration-domain`, `jobs-model`, `job-runner`, `provider-policy`, `usage` y `orchestration-api` cubren T04–13 con D1/workerd real y reloj/random inyectados: ciclos, idempotencia/carreras, leases viejos, heartbeat, backoff/Retry-After, UNKNOWN/reconciliación, pausa, versiones exactas y owner scopes. T12 usa montos/cuotas sintéticos sin llamadas de pago. `orchestration.spec.ts` añade flujo privado con 26 jobs persistidos de fixture, paginación, intentos/reintento, revisión obsoleta, start con respuesta perdida, pausa/resume, configuración manual y polling suspendido/reconectado con reloj del navegador. Axe/capturas/overflow móvil verifican T16. Los tests no requieren cuenta real ni proveedor.

F2-04: `catalog.test.ts` ejecuta esquema nuevo/upgrade desde F2-03, graph con research/script/scene/shot/asset, scopes owner/proyecto y FK directas, payloads/hijos inmutables, candidatas sin autoactivación, CAS/parent/guion activo, numeración concurrente, paginación y lectura corrupta segura. Assets solo metadatos; ninguna prueba afirma haber cargado un binario. Límites cloud y CI alojada quedan sin ejecutar.

F2-02/03: Better Auth real en Worker, esquema verificado por introspección SDK, bootstrap único recuperable, sesión/caducidad/logout, rate limit y dos propietarios aislados. `project-crud.test.ts` cubre T03, idempotencia concurrente, CAS, filtrado/cursor y archivo lógico. `private-env.test.ts` comprueba configuración fuera del repo sin imprimir secretos. El E2E privado recorre tres entradas y cinco pasos con recarga, Atrás, protección de cambios y archivo contra workerd/D1 efímero; la demo F1 se prueba aparte. No hay proveedores simulados presentados como integrados.

F2-01 añade `tests/d1-repositories.test.ts` con D1 real en Miniflare/workerd efímero: esquema desde vacío, upgrade 0003→0005 preservando registros, consulta de índices/FK, constraints, batch rollback, scopes por owner, paginación estable y rechazo seguro de datos corruptos. No abre endpoints privados ni sustituye pruebas de sesión T02. El harness aplica los mismos archivos SQL (una sentencia completa por archivo); el ledger/reaplicación de Wrangler se comprueba con `pnpm db:migrate:local` local dos veces, sin borrar estado.

F1-04 implementa T01 en `tests/contracts.test.ts`, usando builders de `packages/testkit`: entradas vacías, enums, ms/presupuestos no seguros, límites de texto (incluido UTF-8), UUID/UTC, paginación, errores sanitizados y compatibilidad del wire F1-02. `tests/domain.test.ts` verifica suma exacta/overflow sin I/O; `tests/testkit.test.ts` comprueba determinismo y aislamiento. CI declarada en `.github/workflows/ci.yml` reproduce comandos en Ubuntu/Windows con Node/pnpm fijados; solo una ejecución alojada real permite afirmar que ese entorno pasó. La validación local con actionlint no sustituye esos jobs. F1-04 no ejecuta casos de autorización, repositorios ni scheduler de fases posteriores.

| ID | Caso | Resultado verificable |
|---|---|---|
| T01 | Contratos input vacío, enums inválidos, duración negativa, límite tamaño | Rechazo tipado y error seguro |
| T02 | Auth y dos usuarios con recursos de prueba | Ningún acceso cruzado ni URL privada ajena |
| T03 | Crear proyectos de 3 entradas, editar, archivar | Correcto persistir y listar sin pérdida |
| T04 | Idempotency key repetida y key con payload distinto | Mismo job/respuesta; 409 si cambia |
| T05 | Dos agentes reclaman mismo job, lease expira | Solo uno obtiene derecho; completion viejo rechazada |
| T06 | Job con dependencia sin terminar; DAG cíclico | No claim; ciclo rechazado |
| T07 | Reintento rate limit/transitorio, auth falla, timeout ambiguo | Backoff/Retry-After; auth no retry; reconciliar UNKNOWN |
| T08 | Browser cerrado, worker reiniciado, agente offline/reconnect | Estado persistido, retoma sin duplicar costo |
| T09 | Pausa con jobs activos, resume | No nuevos claims; termina/pausa seguro; dependencias correctas |
| T10 | AUTO vs SUPERVISED | Checkpoints ordinarios solo supervisado; blockers ambos |
| T11 | Checkpoint viejo después de editar | 409; no aprobar versión incorrecta |
| T12 | Presupuesto agotado y dos reservas concurrentes | Sin overspend ni fallback pago silencioso |
| T13 | Adaptador falla, capability no disponible, manual import | Error normalizado, ruta manual recuperable |
| T14 | Asset inválido, hash incorrecto, path traversal y URL privada | Rechazo sin leer/escribir fuera del alcance |
| T15 | Regenera visual, voz, narración, audio, montaje | Solo derivados dependientes invalidan; historial íntegro |
| T16 | React UI con loading/vacío/error/offline | Mensajes/acciones, keyboard y foco; progreso no inventado |
| T17 | Manifest con asset faltante/desfase/suma inválida | Bloqueo antes de render |
| T18 | Render local sintético 10–30s | 1920x1080 MP4, codecs perfil, timings/duración y audio validados con FFprobe |
| T19 | Render falla por espacio o proceso interrumpido | Salida parcial no publicada; retry seguro |
| T20 | QA detecta blocker, regeneración correctiva | No READY_RENDER hasta resolver; máximo rondas |
| T21 | Cambiar versión luego de render | Render histórico reproducible; nuevo hash; SEO de render correcto |
| T22 | Backup y restore entorno aislado | Inventario, referencias, versiones, checksums y reproducibilidad |
| T23 | E2E flujo completo simulado corto | Tema→guion→dirección→voz/assets→QA→MP4→YouTube; sin créditos |
| T24 | E2E con guion propio y fuentes + supervisado/manual | Aprobar, importar, pausar, corregir escena y reanudar |
| T25 | Video real representativo 10–15 min | Producción aprobada con métricas de tiempo/costo, QA editorial, derechos y exportación; autorización previa |

## Gate de release

F7-02: escenarios supervisados SCRIPT/SOURCES en `supervised-production.test.ts` reutilizan el recorrido completo con mocks y MP4 real. Verifican checkpoints, rechazo de importaciones inválidas o pausadas, candidata/activación visual acotada y conservación de voz/narración/historial antes de QA/render/export. E2E `supervised.spec.ts` añade teclado/foco, pausa y error recuperable, offline sobre formulario cargado, JSON inválido, respuesta perdida/replay, aprobación, axe y móvil. Se conserva el caso AUTO de F7-01; bundles de fixture aislados evitan carreras.

F7-03/T22: `backup-restore.test.ts` usa D1/R2 persistidos en temp, proyecto completo con MP4 y recurso R2 real. Cierra el Worker, inventaría/copia/restaura, abre otro entorno sin reaplicar DDL, compara conteos de tablas de aplicación, login, paquete/snapshot, recursos R2 y originales locales, y vuelve a renderizar con checksum idéntico. Tablas internas protegidas del runtime no se consultan por la API D1. `backup.test.ts` rechaza corrupción, archivos extra incluso fuera de categorías, rutas peligrosas/secretos, esquema diferente, sobrescritura y enlaces, y acepta R2 aún no inicializado. No modifica el D1 persistido del desarrollador; todos los destinos son nuevos y el cleanup verifica raíz/prefijo propios.

F7-01/T23: `pnpm test tests/auto-production.test.ts` recorre desde tema/proyecto nuevo vía API privada hasta exportación: coordinador real en AUTO, investigación/guion/dirección mock sin checkpoints ordinarios; imagen/tono importados por el cliente Node; candidatos/revisiones, manifest y QA explícitos; claim/heartbeat/render/publicación reales; paquete y MP4 exportados. El cliente del agente se reconstruye desde configuración temporal persistida. Se comprueba que no queden trabajos abiertos, ledger de tres llamadas mock liquidado a cero, external_started=0, snapshot/checksum correctos y red del cliente restringida al Worker de prueba. El fixture representa al propietario para las revisiones vigentes; no demuestra producción hands-free ni voz hablada. FFmpeg/FFprobe/Chromium faltantes producen skip, no aceptación. Credenciales, DB y multimedia son efímeras fuera de Git; cleanup verifica el prefijo/directorio propio. F7-02 conserva alcance supervisado/fallos/UI.

F6-04/T21: `youtube.test.ts` comprueba gate QA/render, aislamiento, CAS, replay concurrente, rechazo de timings alterados, inmutabilidad y metadata histórica después de activar un montaje diferente. `native-render.test.ts` exporta el MP4 real de 10 s, compara checksum/snapshot, repite sin sobrescribir y rechaza archivo exportado modificado o identidad incorrecta. E2E `youtube.spec.ts` prueba editar/revisar, copiar al portapapeles, descargar JSON, recarga, axe y móvil con metadata sintética sin MP4; no sustituye la prueba nativa del archivo. Exportación no publica ni consume proveedores.

F6: `manifests.test.ts` cubre determinismo, snapshots/CAS y recursos/timings inválidos; `renders.test.ts` comprueba publicación atómica, leases e historial; `qa.test.ts` cubre blockers, aprobación explícita, aislamiento, obsolescencia y dos correcciones por snapshot incluso tras repetir informes. `native-render.test.ts` genera MP4 reales de 10 segundos, comprueba perfil/audio/checksum reproducible, interrupción durante frames, disco y recuperación; un fixture negro/silencioso de 3 segundos prueba el rechazo técnico. Fixtures de imagen/tono propios, sin servicios pagados ni voz hablada. Si FFmpeg/FFprobe/Chromium no existen, los casos nativos informan skip; no equivale a validar T18–20. E2E montaje/render/QA usa D1/R2 efímeros y sesión aislada, preview privado, cola recuperable, revisión editorial, teclado/móvil y axe. [Evidencia F6](history/phase-6-validation.md).

F4: `content-agents.test.ts`, `direction.test.ts`, `content-editor.test.ts` y `regeneration.test.ts` cubren JSON/claims/reparación, mocks sin red, publicación fenced, modalidades/duración, edición idempotente/scoped, parent exacto, scopes e invalidación/compatibilidad, reservas UNKNOWN y followups recuperables. E2E `content.spec.ts` usa 26 escenas sintéticas en D1 efímero: editar/comparar/activar, navegación sin guardar, scopes/impacto, respuesta perdida y reintento con misma clave/body, móvil y axe. T15 valida dependencias/metadatos actuales; archivos reales y timings requieren F5. T21 valida que el snapshot sintético de render/job se conserva; MP4/manifests reales y reproducibilidad binaria quedan para F6, sin declararlos integrados.
Unitarios, integración, contratos, E2E y render fixture verdes; migración desde vacío y upgrade; aislamiento usuario y recuperación lease/budget probado; sin secretos en git/logs; backup/restore probado; revisar con propietario estados de UI, costos, fuentes y render final. No declarar producción automática si un proveedor es manual-only. Prueba real separada de CI, sin promesa de monetización, y con presupuesto explícito. Capturar evidencia en STATUS (fecha, tarea, comando, resultado, bloqueo), no solo checklist.
## Validación F5

`media.test.ts`: Better Auth/D1/R2 nativos efímeros, PNG/WAV sintéticos, CRC/MIME/hash, scope, tickets y recuperación de subida/finalize. `agents.test.ts` y `local-agent.test.ts`: pairing cifrado/TTL/hash/replay, dos agentes/lease/revocación, cache sin escapes/symlinks, FFprobe real PNG/WAV/MP3 y registro LOCAL_ONLY sin navegador. Las pruebas nativas declaran skip cuando falta FFprobe (o FFmpeg para crear el MP3); la ejecución Windows registrada tuvo ambos disponibles. No equivale a CI Linux.

`manual.test.ts`: publicación transaccional/replay, pause/UNKNOWN/revisión obsoleta, candidatas y successors persistidos, stock scoped. `voice.test.ts`: duración medible, mock tono/speech=false, timings manuales/estimados, cobertura/solapamientos, inmutabilidad, retiming e invalidación/conservación. `provider-integrations.test.ts`: contratos MANUAL_ONLY, ausencia de credenciales/API activa, compatibilidad y formatos; sin red o créditos externos.

Chromium añade biblioteca, agente/revocación, prompt/manual con respuesta perdida, WAV/segmentos y catálogo de proveedores; incluye axe y móvil. Los owners de fixtures están aislados. La sesión adicional real se crea solo en el harness de tests y se guarda en archivo temporal externo, eliminado al terminar; no hay backdoor de autenticación. Evidencia y límites en [historial F5](history/phase-5-validation.md).
