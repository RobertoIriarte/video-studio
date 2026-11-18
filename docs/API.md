# API v1 y protocolo de agente

## Implementado en F5

Todas las rutas siguientes están bajo `/api/v1`. Web usa sesión/ownership; mutaciones requieren Origin exacto, JSON e Idempotency-Key UUID. El cuerpo binario se admite exclusivamente en la ruta de subida. Los contratos TypeScript/Zod son la fuente ejecutable; la tabla de protocolo propuesta más abajo no sustituye estas respuestas verificadas.

| Ruta | Contrato y comportamiento |
|---|---|
| GET /assets, GET /imports | Páginas de 25, scope owner/proyecto; assets filtra tipo/procedencia/prompt |
| POST /assets/import | Intento idempotente con proyecto, MIME, bytes ≤5 MiB, SHA-256, procedencia y derechos; devuelve ImportDto |
| PUT /imports/:id/content | Octet-stream, size/hash/firma comprobados; estado UPLOADED; comprimidos pendientes de FFprobe |
| POST /assets/:id/finalize | Solo bytes inspeccionados; publica asset y recibo atómicos |
| GET /assets/:id/access | Ticket de cinco minutos, sin claves R2/paths; descarga aún exige sesión y ownership |
| GET /assets/:id/content | Bytes privados con ticket válido; CSP sandbox/nosniff/no-store |
| GET /agents | Estado ONLINE/OFFLINE/REVOKED, capacidades, espacio y último heartbeat; sin token |
| POST /agents/pairing | Código de un uso, cinco minutos; requiere sesión |
| POST /agents/pair | Código, nombre/capacidades y clave idempotente; entrega AgentToken solo al CLI, rate limit |
| POST /agents/:id/revoke | Sesión del dueño y revisión; revoca bearer y vence leases |
| POST /agents/heartbeat | Bearer separado: AgentDto con lastSeenAt; offline tras 45 s |
| POST /agents/jobs/claim | Bearer; `{availableSlots:1}` → `{lease:null|{job,leaseToken,leaseUntil,attemptId,payload,inputRefs}}`; recibo atómico |
| POST /agents/jobs/:id/heartbeat, /complete, /fail | Scope equipo/owner, fencing y recibo por operación; complete habilitado solo para VALIDATE_INPUT |
| GET /agents/imports, GET /agents/imports/:id/content | Un comprimido pendiente del owner y bytes privados autorizados |
| POST /agents/imports/:id/inspect, /fail | Metadatos FFprobe/hash/size coincidentes o INVALID_MEDIA; publicación recuperable |
| POST /agents/assets/register | Metadatos de archivo local inspeccionado y licencia; LOCAL_ONLY, sin recibir paths ni subir bytes |
| GET /jobs/:id/manual | Prompt, referencias descargables, instrucciones y plantilla JSON |
| POST /jobs/:id/manual | expectedRevision y result discriminado RESEARCH/SCRIPT/DIRECTION/ASSET/VOICE; valida referencias y publica candidato/intento/recibo/checkpoint atómicos; rechaza pausa, UNKNOWN y entradas obsoletas |
| GET /providers/integrations | Catálogo revisado MANUAL_ONLY y documentación pública; no prueba cuentas privadas ni activa APIs |

VOICE referencia audio verificado; segmentos manuales opcionales. Ausencia produce ESTIMATED sobre duración real, sin reconocimiento acústico. Revisión y activación explícitas; valores/hijos inmutables. La sesión web nunca acepta bearer del agente como sesión general. Reintentar exige mismo nonce/body; 409 al reutilizar con otro contenido.

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

### Orquestación implementada en F3

GET /jobs acepta projectId/status/cursor/limit; cursor descendente estable por createdAt/id. GET /jobs/:id devuelve intentos y dependencias, sin payload ni tokens de lease. GET /projects/:id/production devuelve resumen, conteos reales, etapas registradas, checkpoints con preview de versión, actividad y presupuesto; plannedTotal es null mientras no exista un plan completo. GET /projects/:id/checkpoints devuelve hasta 25 revisiones pendientes; GET /projects/:id/usage resume ledger en una moneda.

POST /projects/:id/start requiere expectedRevision, borrador confirmado en paso 5 y Idempotency-Key. Cambio de proyecto, primer job y recibo son atómicos; devuelve 202 {projectId,job}. No invoca proveedores: prepara una espera manual/recurso. POST pause/resume usan expectedRevision e Idempotency-Key con snapshot de respuesta; PAUSING no permite resume hasta resolver intentos activos. POST /jobs/:id/retry solo admite FAILED con revisión actual, preserva intentos y rechaza resultados inciertos. Ningún GET ni polling ejecuta jobs.

POST /checkpoints/:id/approve exige expectedRevision del checkpoint, subjectVersionId e Idempotency-Key. Verifica propietario, última versión, hash/inputs y parent/guion compatibles, activa la versión exacta conservando historial y termina el job de revisión en un batch. F4 añade invalidación atómica al cambiar guion con escenas activas o activar dirección nueva. La preview muestra contenido privado guardado; los editores y mocks de F4 se describen abajo.

GET /providers lista solo el owner. POST /providers recibe name/kind e Idempotency-Key y crea exclusivamente MANUAL_ASSIST. PATCH /providers/:id valida expectedRevision, enabled/priority/limits; no acepta secretos ni activación de APIs pagadas. Las referencias preferidas de settings deben pertenecer al owner y estar habilitadas. No se exponen endpoints web para claim/complete, fijar costos, liberar UNKNOWN o fingir resultados de proveedor; agente/importación quedan para F5.

### Inventario de rutas (las restantes siguen planificadas)

F4-04: GET `/scenes/:id/impact?scope=...` devuelve componentes conservados/afectados y recurso requerido, sin efectos. POST `/scenes/:id/regenerate` exige Idempotency-Key, expectedRevision del proyecto, baseVersionId activo, scope e instruction opcional (4000 caracteres), providerId opcional scoped. Job/recibo/CAS son atómicos y la respuesta 202 es snapshot estable, incluso si se perdió la respuesta o la base dejó de estar activa después. No ejecuta proveedor desde un GET. No hay endpoint para habilitar pagos ni simular subida/voz/render. Scope ALL/VISUAL/NARRATION produce plan candidato mock solo con config interna explícita; VOICE/MUSIC/AMBIENCE/EDIT requieren los recursos posteriores. Activaciones congelan versión/revisión revisadas en el diálogo; 409 conserva los cambios locales.

F4 implementa GET/POST `/projects/:id/research` y `/projects/:id/scripts`, POST `.../:version/activate`, GET `/projects/:id/scenes`, GET/PATCH `/scenes/:id`, POST `/scenes/:id/versions/:version/activate`. POST y PATCH que crean candidatas exigen Idempotency-Key; guardan respuesta y hash atómicamente. Input estructurado JSON v1 validado en servidor, expectedRevision del proyecto, baseVersionId scoped; la escena además exige parent activo exacto y guion activo. Guardar no activa. Activar exige acknowledgeImpact=true y revisión del proyecto. Listas de versiones usan cursor por versionNo descendente, 25 por página; escenas por orden/id, 25 por página. Versiones anteriores de F2/F3 siguen legibles con su esquema genérico de catálogo. Los editores no presentan sus formatos antiguos como salidas de agente validadas.

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

### Implementación F6: montaje, QA y render

F6-04 agrega `GET/POST /projects/:id/renders/:render/youtube` (contexto histórico/guardar paquete revisado) y `GET /projects/:id/exports/:package` (paquete, render y manifest exactos). POST requiere `expectedRevision` del proyecto, `metadata`, `acknowledgeReview:true` e idempotency-key. Guardar crea una versión inmutable; capítulos deben coincidir en sceneId/orden/startMs con los frames del render. Listas de paquetes por render: 25, cursor por versión. Render debe ser SUCCEEDED y tener último QA FINAL aprobado, incluso para crear metadata histórica. `GET /agents/projects/:id/exports/:package` ofrece el mismo bundle al bearer de agente del propietario; no acepta paths del navegador ni ejecuta shell. Contratos en `packages/contracts/src/youtube.ts`. No hay subida/publicación automática.

Todas las rutas de proyecto requieren sesión del propietario. Mutaciones POST usan `idempotency-key` UUID, Zod estricto y CAS. Prefijo `/api/v1`.

| Ruta | Contrato implementado |
|---|---|
| GET /projects/:id/manifests | revision, activeId, current, snapshots paginados |
| POST /projects/:id/manifests | expectedRevision, baseVersionId/edits opcionales; candidata inmutable |
| POST /projects/:id/manifests/:version/activate | expectedRevision, acknowledgeImpact:true |
| GET /projects/:id/qa | revision, current, informes paginados |
| POST /projects/:id/qa/run | expectedRevision del proyecto, manifestHash; informe PRE_RENDER |
| POST /projects/:id/qa/:report/approve | expectedRevision del informe, manifestHash, acknowledgeEditorialReview:true |
| POST /projects/:id/qa/:report/repair | expectedRevision del proyecto, findingId; job localizado y ronda 1–2 |
| GET /projects/:id/renders | renders inmutables paginados con métricas y checksum |
| POST /projects/:id/render | expectedRevision, manifestHash, preset:FHD_MP4 opcional; job LOCAL |
| GET /agents/jobs/:id/render-input | leaseToken; snapshot exacto del trabajo |
| GET /agents/jobs/:id/render-assets/:asset | leaseToken; bytes del asset autorizado por snapshot |
| POST /agents/jobs/:id/render-complete | leaseToken, renderId, outputAssetId, metadata, technical con analysisVersion:1 |
| POST /agents/jobs/:id/render-qa-fail | leaseToken, renderId, reason y analysis; FINAL BLOCKED sin asset |
| POST /agents/jobs/:id/pause | leaseToken; pausa en punto seguro |

Rutas `/agents/jobs/*` requieren bearer del agente vinculado/revocable y lease vigente. Un cookie de usuario no sirve como token de agente. No aceptan paths, URLs externas ni comandos de render arbitrarios. QA y publicación comprueban nuevamente snapshot vigente, propietario y referencias; replay conserva respuesta y no consume otra ronda. Listas F6: 25 por página, cursor por versión. Definiciones exactas: `packages/contracts/src/render.ts` y `qa.ts`.

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
