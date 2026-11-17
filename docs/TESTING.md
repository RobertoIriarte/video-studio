# Estrategia de pruebas y aceptación

## Herramientas propuestas
Vitest unit/integration, Playwright E2E de web, pruebas de Worker/D1 locales compatibles con runtime y mocks HTTP. Verificar versiones y compatibilidad antes de fijar dependencias. Fixtures sintéticas pequeñas; sin acceso a producción ni red/IA paga por defecto. Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; `pnpm test:e2e` en fases con UI; indicar comandos reales y salidas resumidas en STATUS. CI reproduce instalación congelada y validaciones. Tests deterministas con reloj falso, IDs/semillas y provider fake; no depender de sleeps reales.

## Matriz de pruebas obligatorias

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
Unitarios, integración, contratos, E2E y render fixture verdes; migración desde vacío y upgrade; aislamiento usuario y recuperación lease/budget probado; sin secretos en git/logs; backup/restore probado; revisar con propietario estados de UI, costos, fuentes y render final. No declarar producción automática si un proveedor es manual-only. Prueba real separada de CI, sin promesa de monetización, y con presupuesto explícito. Capturar evidencia en STATUS (fecha, tarea, comando, resultado, bloqueo), no solo checklist.
