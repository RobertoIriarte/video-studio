# F6-01 a F6-03 — evidencia local

Alcance autorizado: F6-01 a F6-03. Sin F6-04, deploy, servicios cloud, proveedores pagados ni commit/push. Cambios F3–F5 previos conservados.

## F6-01

Contratos render, compileManifest, repositorio/API/migraciones 0133–0136, composición/Player y editor. Types/lint/build pasaron. Manifests 2/2: determinismo, suma/recursos/timings, CAS, replay concurrente, fuentes obsoletas y payload inmutable. E2E montaje 1/1: snapshot, preview real con PNG/WAV privados en R2 efímero, candidata/activación, axe y móvil. ADR 0012 documenta SDK/tipos y límites.

## F6-02

Contratos/DB renders 0137–0140, gates de manifest, endpoints bearer, CLI runner y renderer real. Types/lint/build pasaron. Renders/agents/regeneration 10/10: publicación, fencing, replay, scope y conservación. Native-render 3/3: fixture10s/300frames a1920x1080, H264/AAC/yuv420p/30fps, audio medido y normalizado, dos renders independientes con checksum idéntico, recibo reutilizable, cancelación a partir de frames reales sin final/receipt y reintento nuevo, falta de disco y servidor loopback scoped/rangos. Duración de contenedor10005ms (AAC), dentro de1frame. Chromium de Playwright existente y FFmpeg/FFprobe9.0.2 portable; no descarga de browser durante render ni costos. Prueba nativa completa134.93s, sin skips. E2E cola1/1 sin fingir archivo. ADR0013.

Se corrigieron errores observados antes de marcar DONE: ESM WindowsfileURL, resolver webpack.js→.ts del monorepo, límite D1 de profundidad de expresión y formato de píxel/color SDK. Gate de inputs CASE/vista conserva las validaciones anteriores; no se relajó el perfil de salida. Parsers de FFmpeg acotados, sin logs de paths/tokens. Reintento de parcial reinicia frames del snapshot; un artefacto verificado del mismo intento se reutiliza sin sobrescribirlo.

## F6-03

Contratos y dominio QA, repositorio/rutas, migraciones 0141–0144, pantalla QA y gate de render, análisis FFmpeg final. Hallazgos inmutables por manifest/hash; aprobación editorial explícita, controles de propietario/revisión/vigencia y máximo dos correcciones por snapshot compartidas entre informes. FINAL aprobado/bloqueado y recibo del agente acompañan atómicamente la publicación/fallo. ADR 0014 documenta política y límites.

Focales QA/renders/regeneration 11/11 verdes antes del cierre. Native-render 4/4 en 139.54 s, sin skips: incorpora fixture negro/silencioso de 3 s rechazado y conserva reproducibilidad/recuperación real de F6-02. E2E completo 34/34 en 2.1 min, incluyendo montaje, QA y cola de render, móvil y axe. Advertencias workerd por conexiones cerradas durante navegación sin fallos de prueba. Instalación congelada offline, lint, typecheck y build pasaron. Bundle web ~937 kB: advertencia de tamaño no bloqueante, pendiente optimizar carga diferida.

Primer `pnpm test` completo: 212/222 pasaron, 10 fallaron con timeouts/hook timeouts y procesos interrumpidos, no se considera verde. D1 y render FHD compiten por recursos locales: Vitest queda limitado a dos workers, sin ampliar tiempos ni omitir pruebas. Repetición completa `pnpm test`: 222/222 pruebas en 32 archivos, sin skips, 536.72 s; pasó con dos workers. No se cambiaron los timeouts ni se omitieron casos.

Base local: migraciones 0133–0144 aplicadas, total 144; reaplicar informa «No migrations to apply». Antes/después user/projects/jobs/usage_records/assets 0, qa_reports 0 tras migrar. Sin alterar datos reales ni crear propietario. Servidor demo previo 5173 conservado; servidores efímeros de pruebas cerrados. Sin deploy, commit/push, créditos ni APIs externas.

Cierre final tras reforzar READY_RENDER en API y disponibilidad actual de recursos: build API dry-run y focales QA/renders 6/6 (106.00 s) pasaron; prueban también recibo atómico del agente en éxito/fallo, recurso ausente después de aprobar QA y límite que sobrevive nuevos informes. E2E QA/render repetidos 2/2 (42.3 s), lint/types y diff check verdes. F6-01 a F6-03 DONE, sin bloqueos locales. F6-04 requiere nueva autorización.

## F6-04

Autorizada posteriormente por el propietario. Contratos `youtube.ts`, borrador puro y validación de capítulos por frames, repositorio/API, pantalla YouTube y exportación CLI. Migraciones aditivas 0145–0147 con historial inmutable; sin dependencias nuevas. Cada paquete revisado conserva render/manifest/hash/checksum exactos. Nueva versión de metadata conserva anteriores; un montaje nuevo no altera el render ni el paquete histórico. COMPLETED depende del montaje activo vigente y su paquete, con actualización CAS y reconciliación. ADR 0015 registra decisiones y recuperación.

Pruebas focales YouTube 2/2 (44.50 s) después de corregir un intento de evento no admitido por el enum existente; se conservó ese contrato y se retiró el evento, sin relajar constraints. Build completo y types pasaron; lint detectó un catch sin cause y pasó tras corregirlo. Native-render 4/4 (140.93 s), sin skips: MP4 real de 10 s exportado a carpeta nueva, checksum y manifest idénticos, reintento verificable y rechazo de archivo modificado/identidad incorrecta. No se presentó metadata sintética como archivo real.

E2E YouTube focal 1/1 (43.1 s); completo 35/35 (1.5 min), incluyendo copiar con portapapeles real de Chromium, descarga JSON, versiones/recarga, móvil/axe, bearer de agente y aislamiento de paquetes. La fixture de esta UI solo aporta metadata sintética, sin MP4. El resultado de la regresión general y el cierre del ajuste de estado se detallan al final.

Base local: 147 migraciones, reaplicación sin pendientes; user/projects/jobs/assets/youtube_packages 0. No se creó propietario ni se alteraron datos reales. Sin deploy, créditos, commit/push ni publicación en YouTube. SEO inicial determinista editable sin IA ni proveedor externo; revisión humana explícita. Exportación completa lleva COMPLETE.json con checksums; carpeta parcial requiere otro destino tras resolver el fallo, no se sobrescribe ni borra automáticamente.

Cierre de regresión: `pnpm exec vitest run --exclude tests/native-render.test.ts` ejecutó 220 casos: 219 pasaron y un smoke de workspace falló porque esa invocación no define npm_execpath. Sin tocar la prueba, `pnpm test tests/workspace.test.ts` pasó 2/2 (1.26 s), resolviendo el fallo de invocación. No se presenta la primera ejecución como verde. Cobertura no nativa completa validada entre ambas ejecuciones, con dos workers. Cierre focal YouTube tras ajuste atómico de COMPLETED: 2/2 (42.50 s). Native MP4/export repetido tras reforzar hashes contra el paquete: 1/1 seleccionado (93.73 s); los otros tres no se seleccionaron en esa repetición y ya habían pasado en el nativo completo 4/4. Build completo final, typecheck, lint, diff check y doctor del CLI compilado pasaron; FFprobe y render disponibles. Bundle web ~945 kB, advertencia conocida sin bloqueo.

E2E YouTube final sobre el build final: 1/1 (43.7 s) pasó, incluidos bearer/aislamiento. F6-04 DONE, sin bloqueos locales. Fase 6 completa; F7-01 pendiente de autorización. No commit/push ni despliegue.
