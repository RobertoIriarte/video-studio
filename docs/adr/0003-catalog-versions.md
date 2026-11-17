# 0003 — Catálogo versionado local

Fecha: 2026-11-17. Concreción de DATA para F2-04, sin cambio de arquitectura.

Migraciones aditivas 0019–0064: research_versions, sources, script_versions, scenes, scene_versions, shots, assets y asset_links. Cada archivo contiene una sentencia DDL completa para el harness D1 existente; incluye índices y triggers separados. projects recibe el puntero nullable de guion previsto. El upgrade preserva proyectos, settings y recibos existentes.

Las FK compuestas incluyen proyecto: research→script, scene/script/parent→scene_version y assets→shots/links. assets también tiene FK `(project_id,owner_id)` a projects. La propiedad del proyecto no cambia. El puntero de escena referencia su escena/proyecto; el de guion exige una versión aprobada del mismo proyecto. No hay cascades destructivas de catálogo.

Los repositorios crean candidatas en batches atómicos. Research y escena se construyen como DRAFT dentro del batch, con hijos, y se publican como CANDIDATE al terminar. Los payloads/identidades de versiones nunca se actualizan ni se borran; hijos publicados quedan congelados también contra inserts/reasignaciones SQL. El hash SHA-256 canónico cubre el input y las referencias. Aprobar/activar exige versión exacta y CAS; activación conserva la anterior como SUPERSEDED. Una candidata no mueve punteros. El parent de escena debe ser la activa exacta y el guion debe coincidir con el activo aprobado.

F4 añadirá checkpoints, interfaz y propagación de invalidación. Hasta entonces se rechaza cambiar un guion con escenas activas y editar/archivar un borrador con guion activo. No se crea una invalidación incompleta ni se encola producción en esta tarea. Los métodos son internos, con owner explícito; no se exponen endpoints públicos nuevos de generación/aprobación.

Assets registra metadatos inmutables y nace MISSING: no afirma que un archivo haya sido cargado/verificado. DTO sin r2_key ni paths; disponibilidad separada del contenido. Importación y verificación binaria quedan para F5-01. No hay conexión R2 ni proveedor real. provider_id/generation_id quedan nullable para sus tablas futuras.

Defaults reversibles: JSON de catálogo 256 KiB por objeto; research hasta 32 fuentes; escena hasta 16 tomas y 16 enlaces. Se valida MIME/tipo, rangos, hash, suma de tomas y referencias. Lecturas de assets se agrupan en una consulta, evitando N+1 durante creación. Las estructuras concretas de agentes se definirán en F4; aquí JSON versionable acotado no representa un output IA validado. Paginación interna de IDs ascendente estable; HTTP de catálogo queda para su tarea de UI/importación. Límites cloud definitivos V05 siguen pendientes.
