# Modelo de datos y versionado

## Convenciones
SQLite/D1, IDs UUID TEXT opacos; UTC ISO 8601; duraciones ms enteras; BOOLEAN lógico 0/1; JSON TEXT validado por Zod en borde y al leer. FK con propiedad de proyecto comprobada mediante joins y scope por usuario; índices operativos. No duplicar campo de estado derivado sin regla de actualización. Soft delete de proyecto; eliminación física fuera MVP. Better Auth gestiona tablas de sesión/usuarios según adaptación verificada, no reinventar auth. Migraciones SQL numeradas forward-only, probar desde vacío y upgrade. Campos auditables created_at, updated_at, revision donde hay concurrencia.

## Esquema lógico (obligatorio; SQL definitivo en tarea F2)
| Tabla | Campos principales e invariantes |
|---|---|
| projects | id PK, owner_id FK auth user, title, input_type, input_text, mode, status, active_script_version_id nullable, revision, created_at, updated_at, archived_at; index owner/status/updated_at |
| project_settings | project_id PK/FK, language, audience, objective, target_duration_ms, style, style_version, modality, checkpoint_policy_json, provider_policy_json, budget_currency, max_cost_micros, storage_policy_json, revision |
| research_versions | id PK, project_id, version_no, data_json, content_hash, status, created_at; unique(project_id,version_no) |
| sources | id PK, research_version_id, url nullable, title, acquired_at, excerpt/notes, provenance, access_status; sin inventar URLs |
| script_versions | id PK, project_id, research_version_id nullable, version_no, script_json, content_hash, target_duration_ms, status, created_at; unique(project_id,version_no) |
| scenes | id PK, project_id, stable_key, order_index, active_version_id nullable, revision, archived_at; unique(project_id,stable_key) |
| scene_versions | id PK, scene_id, script_version_id, parent_version_id nullable, version_no, narration, direction_json, duration_ms, generation_scope, status, hash; unique(scene_id,version_no) |
| shots | id PK, scene_version_id, order_index, duration_ms, type, prompt, camera_json, transition_json, asset_id nullable; unique(scene_version_id,order_index) |
| assets | id PK, project_id, owner_id, type, mime, bytes, checksum, duration_ms nullable, width/height nullable, origin, provider_id nullable, generation_id nullable, license_json, prompt nullable, r2_key nullable, availability, created_at; indexes project/type, owner/hash |
| asset_links | id PK, scene_version_id, asset_id, role, offset_ms, trim_start_ms, trim_end_ms nullable; enforce same owner; immutable with version |
| voice_segments | id PK, scene_version_id, audio_asset_id, segment_index, text, start_ms, end_ms, alignment_json; nonnegative, end>start |
| jobs | id PK, project_id, scene_id nullable, kind, execution_target, status, payload_json, output_ref nullable, idempotency_key, input_hash, attempt_count, max_attempts, next_run_at, lease_until, lease_token nullable, agent_id nullable, progress_json, error_json nullable, created_at, updated_at; unique(project_id,idempotency_key); indexes(status,next_run_at), project/status, lease_until |
| job_dependencies | job_id, depends_on_id; composite PK; DAG only, same project |
| job_attempts | id PK, job_id, attempt_no, request_id, provider_operation_id nullable, start/end, status, error_code, result_json; unique(job_id,attempt_no) |
| agent_runs | id PK, job_id, agent_role, prompt_version, model_alias, input_hash, output_json, validation_status, usage_json, started/ended |
| checkpoints | id PK, project_id, stage, subject_version_id, status, reviewed_by nullable, reviewed_at nullable, revision; unique subject/stage |
| provider_configs | id PK, owner_id, kind, adapter_key, integration_mode, enabled, priority, caps_json, limits_json, credential_ref nullable, status, updated_at; no plaintext secrets |
| generations | id PK, job_id, attempt_id, provider_id, operation_id nullable, kind, input_hash, status, output_asset_id nullable, estimated_cost_micros, actual_cost_micros nullable, currency, error_code nullable |
| usage_records | id PK, owner_id, project_id, generation_id nullable, event_key, status RESERVED/SETTLED/RELEASED/UNKNOWN, amount_micros, currency, units_json, created_at; unique(owner_id,event_key) |
| local_agents | id PK, owner_id, display_name, token_hash, last_seen_at, capabilities_json, disk_free_bytes, revoked_at nullable |
| qa_reports | id PK, project_id, manifest_hash, version_no, findings_json, status, created_at |
| renders | id PK, project_id, job_id, manifest_hash, manifest_json, preset, version_no, status, output_asset_id nullable, checksum nullable, duration_ms nullable, created_at |
| youtube_packages | id PK, render_id, version_no, title, description, chapters_json, tags_json, thumbnail_ideas_json, status |
| activity_events | id PK, owner_id, project_id nullable, actor_type, actor_id, action, entity_id, details_json, created_at |

## Integridad y ciclos de vida

F2-04 implementa las ocho tablas de catálogo y sus repositorios internos con FK compuestas, índices y triggers de inmutabilidad. Activaciones CAS y candidatas conservan historial. Assets nace MISSING, solo metadatos. Restricciones y límites de esta fase en [ADR 0003](adr/0003-catalog-versions.md). voice_segments, jobs, agentes, proveedores, usage y render pertenecen a fases posteriores; no se crean por anticipado.
Versiones DRAFT/CANDIDATE/APPROVED/SUPERSEDED/INVALIDATED. Contenido binario y payload de una versión son inmutables tras publicar; puntero activo cambia condicionalmente usando revision y validación del parent. Anterior activa se conserva. Invalidación de una dependencia marca derivados obsoletos sin borrar. Manifest fija IDs + hashes de assets/versions, orden y timings; no depende de punteros vivos durante render. Cambiar contenido no altera render histórico.

## Estado de proyecto
DRAFT, RUNNING, WAITING_APPROVAL, WAITING_RESOURCE, PAUSING, PAUSED, FAILED, READY_RENDER, RENDERING, COMPLETED, ARCHIVED. Estado derivado de etapa/checkpoint/job y bandera pause_requested; actualizar en misma operación cuando sea posible o reconciliar. READY_RENDER requiere manifest válida y QA sin bloqueo. COMPLETED requiere render verificado y paquete YouTube listo (mostrar render listo aunque SEO esté pendiente). No recuperar por borrado de jobs.

## Índices y mantenimiento

F3 añade migraciones 0065–0109: jobs/attempts/dependencies/activity/checkpoints, recibos, configuración y ledger. FK por proyecto/owner/proveedor, ciclos SQL rechazados y claves de identidad/fencing inmutables. Cambios de job, intento, actividad y reserva/liquidación ocurren en batches condicionales. Los recibos conservan el resultado original de comandos repetidos; UNKNOWN mantiene reservado el tope hasta verificación. La preparación/revisión usa los repositorios de catálogo existentes; no se crean renders ni generaciones de proveedor por anticipado. Detalle en ADR [0004](adr/0004-d1-orchestration.md) y [0005](adr/0005-provider-budget-policy.md).
Paginación cursor estable por (updated_at,id) o (created_at,id). Índice en todas las FK consultadas frecuentemente, version_no por padre, owner de recursos, status/next_run_at y provider. Consultas por owner antes de mutar; no confiar en IDs del cliente. Probar constraints, duplicados, repo, migraciones y consistencia de costos. No realizar cascades destructivas de media sin autorización.

## Baseline local implementado en F2-01

F4 añade 0110–0117: content_expansions, direction_expansions y scene_expansions como marcas de planificación recuperable; content_changes scoped e inmutable para auditoría; job_version_compatibility con FK por job/proyecto/escena y versiones exactas. No se modifican payloads aprobados ni hashes existentes. DTOs de catálogo anteriores siguen legibles; salidas nuevas de agentes usan esquemas JSON v1 adicionales. Modelo/prompt/output se guardan en catálogo privado y el input hash en jobs; no se introduce una tabla agent_runs redundante en esta entrega. Véase ADR 0006.

`infra/migrations/0001` a `0005` crean solo `user`, `projects`, `project_settings` y los índices `(owner_id,updated_at DESC,id DESC)` / `(owner_id,status,updated_at DESC,id DESC)`. No crean tablas de versiones, jobs, media ni sesiones. Los índices PK/UNIQUE cubren identidad, email y FK de settings; las FK de owner y proyecto usan RESTRICT, sin cascades destructivas.

SQL comprueba claves no nulas/formato UUID básico, enums, campos requeridos, rangos enteros seguros, booleanos, forma JSON y consistencia de archivado. Los repositorios validan además con los contratos Zod completos: idioma/moneda, referencias UUID y estructura semántica de JSON. Un registro persistido inválido o un proyecto sin settings genera `RepositoryDataError` con mensaje fijo, sin reflejar contenido.

Creación de borrador y settings atómica mediante batch D1, IDs/fecha recibidos desde contexto servidor explícito y revisión inicial 1. Lecturas/listas de proyectos y settings exigen owner; archivados quedan fuera sin borrar filas. Listas no seleccionan `input_text`, usan límite 25/máximo 100 y cursor interno `(updatedAt,id)` descendente. La codificación de cursor HTTP y las mutaciones de edición/archivado quedan para F2-03. El owner debe proceder de identidad autenticada en las futuras rutas; esto no sustituye T02 ni implementa autenticación.

`mode` está en projects y se incorpora al DTO settings al leer; settings mantiene su revisión independiente. `active_script_version_id` queda diferido a F2-04 con FK real. `style_version=1` y storage JSON vacío son defaults iniciales. Proyectos usan UTC canónica `YYYY-MM-DDTHH:mm:ss.sssZ`; el repositorio normaliza la fecha de contexto a ese formato. Las fechas de `user` quedan bajo el futuro adaptador Better Auth. Alcance y V01 pendiente: [ADR](adr/0001-local-d1-foundation.md).
## Implementación F6

F6-04: migraciones aditivas 0145–0147, `youtube_packages` con FK render/proyecto, versión única por render y triggers contra UPDATE/DELETE. `package_json` congela metadata revisada, manifestId/hash y checksum de salida; `content_hash` identifica ese contenido. Recibos idempotentes y revisión CAS evitan duplicación/sobrescritura. El estado COMPLETED se reconcilia con render/paquete del manifest activo vigente, conservando exportación de históricos. [ADR 0015](adr/0015-render-export-youtube.md).

Migraciones aditivas 0133–0144: render_manifests, active_manifest_id, renders, qa_reports y vistas current_render_manifests/render_ready_manifests. Snapshots, findings e identidad de renders son inmutables; triggers impiden borrar historial. FK compuestas mantienen manifest/render/informe dentro del mismo proyecto. Datos operativos (estado, revisión y aprobación) se actualizan mediante CAS. No se altera el contenido de versiones previas.

Los renders conservan manifest_json y hash exactos, job, checksum y technical_json; assets LOCAL_ONLY y asset_locations identifican el equipo productor sin almacenar paths. Informes PRE_RENDER/FINAL registran hallazgos y revisión humana/técnica. Jobs de corrección incorporan qaReportId/findingId/round en payload servidor; límite atómico de dos por manifest. Recibos de comandos evitan publicación o corrección duplicada. [ADR 0012](adr/0012-render-manifests.md), [0013](adr/0013-local-render-runner.md) y [0014](adr/0014-snapshot-qa.md).

## Implementación F5

Migraciones aditivas 0118–0132: asset_imports con identidad/checksum/estado/inspección, local_agents, agent_pairings, agent_commands, asset_locations y voice_segments. No sustituyen ni eliminan tablas/versiones existentes. El original de importación se conserva en su recibo; UPLOADED/VERIFIED y error de inspección son estado operativo.

El token definitivo del agente solo se almacena como hash SHA-256; pairing y su recibo de entrega se cifran AES-GCM, un uso y TTL de cinco minutos, purgados al consultar/heartbeat después de caducar. La configuración local queda fuera de Git. No hay paths de disco en DTOs/D1: asset_locations registra identidad de equipo y asset, no una ruta enviada por el navegador.

voice_segments tiene FK compuestas a escena/audio del mismo proyecto, orden único, límites de tiempos y triggers de inmutabilidad. Cada candidata posee sus segmentos; la activa anterior conserva los suyos. Campo de input opcional y DTO con array vacío por defecto mantienen compatibilidad de versiones F2/F4. TIMING incluye segmentos; campos informativos de revisión de voz no cambian por sí solos el hash visual. [ADR 0007–0011](adr/0007-private-media-import.md).
