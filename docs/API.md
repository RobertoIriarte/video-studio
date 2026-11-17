# API v1 y protocolo de agente

## Contratos comunes
Base `/api/v1`, JSON UTF-8, sesión Better Auth para web; credencial de agente solo para rutas de agente. Requests y responses Zod exportados por contracts. DTOs camelCase, UUID opaco, timestamps UTC, durationMs entero. Lista `{items: T[], nextCursor: string|null}`; default limit 25, máximo 100. Errores `{error:{code,message,details?,requestId,retryable}}`. 400/422 input inválido, 401 no autenticado, 403 acción no autorizada, 404 recurso inexistente o ajeno, 409 conflicto/versión/estado, 429 límite, 503 dependencias no disponibles; no devolver stack ni secretos. Autorización por usuario en cada llamada, incluidas relaciones. Todos los POST que generen efectos requieren `Idempotency-Key` (UUID cliente) y guardan hash de request; mismo key+payload devuelve mismo resultado, distinto payload → 409. PATCH requiere `expectedRevision`; 409 devuelve revision vigente y no sobrescribe.

## Rutas REST (prefijo omitido)

### Diagnóstico implementado en F1-02

`GET /api/v1/health` devuelve `{status:"ok"}` (liveness del Worker, no readiness de D1/R2/proveedores). `GET /api/v1/version` devuelve `{apiVersion:"v1",version:"0.0.0"}`; `version` procede de `APP_VERSION` validada. Son rutas públicas de diagnóstico sin datos privados; las rutas de negocio con sesión aún no están implementadas.

Respuestas JSON UTF-8, `Cache-Control: no-store` y `X-Request-Id` generado en servidor como UUID, ignorando el valor enviado por el cliente. Rutas o métodos no registrados: 404 `NOT_FOUND`; excepción inesperada: 500 `INTERNAL_ERROR`; configuración local inválida: 503 `SERVICE_UNAVAILABLE`. Usan el sobre común, con el mismo `requestId` que el header, sin stack ni datos de entrada. Estos errores llevan `retryable:false`: los fallos de configuración requieren corrección y no se asume que una excepción arbitraria sea transitoria. No se habilita CORS ni se crean cookies.

Los esquemas Zod y tipos correspondientes viven en `packages/contracts/src/system.ts`. Son la primera definición de contratos de infraestructura; no hay datos persistidos que migrar ni se modifican DTO de negocio existentes. Los demás contratos y códigos se añadirán en sus tareas con pruebas de compatibilidad.

### Proyectos implementados en F2-03

POST/list/get/PATCH/archive de proyectos están disponibles con sesión real. POST exige Idempotency-Key y guarda respuesta/hash atómicamente; archive repetido reproduce el resultado original. PATCH exige expectedRevision, admite campos parciales y solo modifica DRAFT sin guion activo; conflicto incluye `error.details.currentRevision` conservando el sobre común. Los errores por campo usan `error.details.issues`. El detalle añade `inputText` y `wizardStep` (1–5) al DTO base sin cambiarlo. No se inventan etapas, progreso ni blockers de jobs aún inexistentes.

Listado cursor descendente `(updatedAt,id)`, q/status en SQL antes de paginar y sin cargar texto largo. Preferencias de proveedores no vacías se rechazan mientras no exista configuración autorizada. Wizard guarda cada paso con revisión y conserva datos al retroceder. Archivo es lógico, exige confirmación web y conserva settings. Solo se permite editar/archivar DRAFT en esta fase para evitar mutaciones de producción sin análisis de impacto. Start/pause/resume permanecen pendientes del scheduler.

### Inventario de rutas (las restantes siguen planificadas)

| Método y ruta | Input principal | Salida/efecto |
|---|---|---|
| POST /projects | title,inputType,inputText,settings | 201 ProjectDto borrador |
| GET /projects | cursor,limit,status,q | 200 lista |
| GET /projects/:id | — | ProjectDetail con stages, progress y blockers |
| PATCH /projects/:id | expectedRevision,title/settings modificados | ProjectDto; confirmar impacto si activa |
| POST /projects/:id/archive | expectedRevision | Soft archive; no borrar assets |
| POST /projects/:id/start | expectedRevision | 202 job inicial, estado; sin duplicados |
| POST /projects/:id/pause | — | 202 PAUSING/PAUSED |
| POST /projects/:id/resume | — | 202 estado y blockers |
| GET /projects/:id/research | — | versión activa + fuentes |
| GET /projects/:id/scripts | cursor | versiones |
| POST /projects/:id/scripts | text,parentVersionId | versión candidata; impacto |
| GET /projects/:id/scenes | cursor | SceneSummary[] |
| GET /scenes/:id | — | SceneDetail, versión activa y referencias |
| PATCH /scenes/:id | expectedRevision,narration/direction/shot edits | versión candidata, no mutar aprobada |
| GET /scenes/:id/versions | cursor | versiones |
| POST /scenes/:id/versions/:versionId/activate | expectedRevision,acknowledgeImpact | activa si compatible; invalida derivados |
| POST /scenes/:id/regenerate | baseVersionId,scope,instruction?,providerId? | 202 job, estimación, candidato futuro |
| GET /projects/:id/checkpoints | — | checkpoint y versión |
| POST /checkpoints/:id/approve | subjectVersionId,expectedRevision | aprueba versión exacta y encola dependientes |
| GET /jobs | projectId,status,cursor | lista job cards |
| GET /jobs/:id | — | JobDetail con intentos, progreso, error seguro |
| POST /jobs/:id/retry | providerId?,acknowledgeCost? | 202 reintento permitido |
| GET /assets | projectId?,type,q,cursor | catálogo del propietario |
| POST /assets/import | projectId, metadata,checksum,sizeBytes,mime | instrucción de carga autorizada y asset provisional |
| POST /assets/:id/finalize | checksum, bytes | asset verificado |
| GET /assets/:id/access | — | URL temporal autorizada o estado local-only |
| GET /providers | kind | capacidades/precio estimado/estado |
| PATCH /providers/:id | priority,enabled,limits | configuración sin secreto |
| GET /projects/:id/usage | — | reservado, liquidado, desconocido, moneda, presupuesto |
| GET /projects/:id/qa | — | findings y hash manifest |
| POST /projects/:id/qa | manifestHash | 202 ejecución |
| POST /projects/:id/render | manifestHash,preset=FHD_MP4 | 202 job con snapshot |
| GET /projects/:id/renders | — | historial y disponibilidad |
| GET /projects/:id/youtube | renderId | paquete de render elegido |
| POST /projects/:id/youtube | renderId | 202 generación paquete |

## DTO mínimos
```
ProjectSettings = {language:string,audience:string,objective:'YOUTUBE_LONG',targetDurationMs:number,style:'DOCUMENTARY'|'PREMIUM_REALISTIC'|'HORROR_MYSTERY',modality:'DYNAMIC_IMAGES'|'HYBRID'|'CINEMATIC'|'EXPLAINER',mode:'AUTO'|'SUPERVISED',budget:{currency:string,maxMicros:number},providerPolicy:{allowPaidFallback:boolean,preferredIds:string[]},checkpoints:string[]}
ProjectDto = {id,title,inputType:'TOPIC'|'SCRIPT'|'SOURCES',status,revision,settings,createdAt,updatedAt}
JobDto = {id,projectId,sceneId?,kind,status,executionTarget:'CLOUD'|'LOCAL'|'MANUAL',attempt,maxAttempts,nextRunAt?,progress:{completed?:number,total?:number,message:string},error?:{code,message,retryable},updatedAt}
SceneSummary = {id,title,orderIndex,activeVersionId?,durationMs,startMs,endMs,status,shotCount,revision}
GenerationRequest = {projectId,sceneVersionId,shotId?,kind,prompt,negativePrompt?,referenceAssetIds,requestedDurationMs?,aspectRatio:'16:9',providerId?,idempotencyKey}
```
Zod: strings recortados con límites (título 1–200, instrucciones 0–4000, texto de entrada con máximo configurable), duración positiva, enum, IDs y monedas válidos, límites bytes y MIME por tipo. Refinements: input no vacío, referencias pertenecen al usuario, duración suma coherente, presupuesto no negativo, transiciones válidas. El DTO no expone hashes de token, secretos, paths arbitrarios ni payloads internos sensibles.

## Base de contratos implementada en F1-04

`packages/contracts` define `projectInputSchema` (POST futuro), `projectSettingsSchema`, `projectDtoSchema`, enums y primitivas comunes. Sus tipos se infieren de Zod. Los endpoints de negocio siguen pendientes; no se añade CRUD, autorización ni persistencia en F1-04.

- Objetos estrictos: se rechazan campos desconocidos, incluidos `ownerId`, secretos y paths no declarados. UUID opacos, timestamps UTC con sufijo `Z`, revisiones enteras positivas y milisegundos enteros positivos; números dentro de `Number.MAX_SAFE_INTEGER`.
- Título recortado de 1–200 caracteres Unicode e instrucciones de 0–4000 (semántica de longitud del Zod fijado). Entrada no vacía tras trim, máximo **1 MiB UTF-8 bruto** por defecto, antes de trim. `createProjectInputSchema({maxInputBytes})` permite ajustar ese límite con un entero positivo seguro de configuración confiable. La API limita además el body JSON a 6 MiB + 16 KiB, contemplando escapes del texto válido.
- Defaults reversibles de tamaño: idioma BCP 47 estructuralmente válido (máximo 35), audiencia 1–500, hasta 32 UUID de proveedor distintos, hasta 16 checkpoints distintos de 1–64 caracteres; moneda mayúscula reconocida por `Intl.supportedValuesOf('currency')` del runtime y presupuesto seguro no negativo. Estos límites no verifican disponibilidad de proveedor, propiedad de referencias ni autorización de gasto. Checkpoints se validan estructuralmente; la política de etapas pertenece a la orquestación posterior.
- Paginación base: default 25, máximo 100; acepta enteros o strings decimales del query, sin coercionar booleanos, floats o notación exponencial. Cursor opaco no vacío de hasta 2048 caracteres. Respuesta `{items,nextCursor}` con hasta 100 items; no se implementa codificación/consulta de cursor todavía.
- `safeValidationIssues(ZodError)` exporta hasta 20 incidencias `{path:string[],code,message:'Valor no válido.'}`; no incluye valores del input, mensajes internos ni stack. La futura ruta elegirá status HTTP y requestId y compondrá el sobre de error; no devolver ZodError crudo.

Compatibilidad: los esquemas wire de health/version/error F1-02 permanecen intactos, con pruebas de ejemplos previos y de Worker real. Los DTO de proyecto son una primera definición; no existen registros de negocio que migrar. No se establecen transiciones de estado ni nuevos contratos jobs/assets/render en esta tarea.

## Agente local
Registrar mediante sesión web y código de vinculación de un solo uso, corto TTL, confirmado por dueño; emitir token de agente aleatorio, guardar hash servidor, revocable y de alcance limitado. No usar token usuario ni API key proveedor como identidad.
| Ruta | Contrato |
|---|---|
| POST /agents/pair | código, nombre, capacidades | token una vez |
| POST /agents/heartbeat | versión, capabilities, diskFreeBytes, activeJobIds | serverTime, revocation check |
| POST /agents/jobs/claim | capabilities, availableSlots | 200 jobs compatibles y leaseToken; lista vacía si nada |
| POST /agents/jobs/:id/heartbeat | leaseToken, progress | renovar lease, pauseRequested |
| POST /agents/jobs/:id/complete | leaseToken, result, checksums | commit idempotente de output y dependientes |
| POST /agents/jobs/:id/fail | leaseToken,errorCode,retryable,safeDetails | fallo/retry programado |
| GET /agents | — sesión web | estado y diagnóstico |
| POST /agents/:id/revoke | — sesión web | revocar token y expirar lease |

Propuesta inicial: poll 5s sin trabajo con backoff hasta 30s, heartbeat 15s y lease 90s configurables. Reloj servidor gobierna; actualizaciones condicionales por job/owner/token vigente, worker viejo no puede completar lease nuevo. Agent recibe únicamente assets/manifests autorizados, no comandos shell arbitrarios. Tras reinicio, reconciliar estado de job con servidor; si lease perdido, no publicar nuevo output sin permiso. Network timeout no equivale a fallo de generación externa. Ver SECURITY y PIPELINE.
