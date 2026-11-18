# Fase 5 — evidencia local

Alcance autorizado: F5-01 a F5-05; el propietario aclaró que no incluye F6. Se conservan F3/F4 sin commit/push. Sin despliegue, recursos cloud ni autorización de gasto. Fixtures generadas en memoria, ningún binario pesado va a Git.

## F5-01 — importación/biblioteca

Contratos de importación, metadata, paginación y acceso privado; migraciones aditivas 0118–0120 para intents/identidad inmutable. R2 real emulado en Miniflare y Wrangler local (`remote:false`). Scope por propietario/proyecto, checksum SHA-256 y tamaños comprobados antes de escribir; claves generadas por servidor, nunca paths/nombres de cliente.

Inspección limitada de contenedor: PNG comprueba CRC de chunks/dimensiones; JPEG/WebP cabeceras/dimensiones; WAV PCM/float verifica contenedor y calcula duración desde frames/byte-rate. No es QA editorial ni decodificación multimedia completa. MP3/Ogg/MP4 se conservan pendientes hasta inspección FFprobe del agente; no se publican como recursos verificados. Máximo web propuesto 5 MiB, imágenes hasta 8192 por eje y 16 Mpx. Archivos mayores se tratarán mediante agente local, sin subir por defecto.

Intent y finalize idempotentes, publicación D1 atómica con recibo; R2 puede contener un objeto pendiente si la llamada se corta, recuperable con la misma clave/checksum. No se borra un binario/historial durante recuperación. Preview exige sesión, owner y ticket HMAC de cinco minutos, sin exponer r2_key. URLs externas solo se guardan como texto de procedencia, sin descargas. Biblioteca filtra proyecto/tipo/prompt/licencia; audio no cambia su URL cada cinco segundos al reproducir.

`pnpm.cmd lint`, `pnpm.cmd typecheck`, suite completa **196/196** y `pnpm.cmd build` pasaron (3 pruebas nuevas D1/R2 nativos); pruebas verifican checksum/tipo/origen/path, scopes entre dos owners, CRC/duración, idempotencia, bytes reales y caducidad del acceso. Las 27 pruebas E2E anteriores pasaron; la nueva de biblioteca pasó focalizada **1/1**, incluyendo axe/móvil y respuesta de subida perdida. Se corrigió overflow real de formulario/filtros y se aislaron owners de fixtures para evitar interferencia en el conteo de jobs.

La biblioteca E2E usa sesión real de Better Auth generada por SDK interno y storageState sintético temporal fuera del repo, con permisos restringidos y eliminación al finalizar el runner. Evita consumir el rate-limit de los tres flujos que prueban login UI; no se desactiva la protección ni se añade una ruta de backdoor. Contraseñas continúan aleatorias por ejecución, sin valores en Git. El aviso de chunk web (~539 kB) es no bloqueante y no se cambió el umbral.

## F5-02 (2026-11-18)

Contratos local-agent, migraciones 0121–0128, API/db agents y job-runner, CLI/cache/probe/config/client y pantalla AgentsPage. Suite focal agents/local-agent 6/6; inspecciones PNG/WAV y MP3 con FFprobe nativo real, pairing/TTL/hash/replay, carrera de claim y revocación. Lint, typecheck, suite completa 202/202 (25 archivos), build y E2E completo 29/29: pasaron. `dev:agent doctor` verificó FFprobe 9.0.2 y disco local. Sin tokens reales ni medios en Git. Instalación portable y límites en ADR 0008.

## F5-03 (2026-11-18)

ManualRepository/contratos/UI manual, runner publishManual, CLI import/config pendiente. Pruebas manual 3/3 (D1 real), local-agent 3/3 (FFprobe y registro LOCAL_ONLY nativos), lint/typecheck/build y Chromium focal manual 1/1: pasaron. Incluye concurrencia, replay exacto, entrada obsoleta/pausa/UNKNOWN sin candidatas huérfanas, checkpoint, activación, sucesor persistido, asset scoped, JSON inválido y respuesta perdida. Sin costo externo registrado como cero; ADR 0009.

## F5-04 (2026-11-18)

Migraciones 0129–0132, contratos voice/scene opcionales compatibles, retiming/estimación pura, MockVoiceAdapter tone/speech=false, persistencia y vistas de voz/segmentos. Lint/typecheck/build, pruebas voice/manual/regeneration/direction/catalog 24/24 y Chromium focal voz 1/1: pasaron. WAV verificado de 1250 ms en E2E; cobertura/solapamiento/tiempos/ownership, candidata, triggers inmutables, invalidación y conservación del historial. Límite: estimación matemática revisable, no forced alignment ni evaluación de calidad de voz hablada. ADR 0010.

## F5-05 y cierre (2026-11-18)

Revisión de fuentes oficiales y catálogo de capacidades en packages/providers/src/integrations.ts, contrato compartido, GET privado /providers/integrations y UI de proveedores. Estado MANUAL_ONLY para texto, imagen, video, voz y stock; APIs sin configurar ni gasto autorizado. ADR 0011 registra fuentes, beneficios potenciales no comprobados en cuentas del propietario y modelos preview retirados. No se implementó HTTP externo ficticio ni se hizo ensayo de créditos.

Comprobaciones reales de cierre:
- `pnpm.cmd install --offline --frozen-lockfile`, lint y typecheck: pasaron. Cambio de lock acotado a Zod directo en local-agent, misma versión existente.
- `pnpm.cmd test`: 210/210 en 28 archivos, sin skips en este Windows. `pnpm.cmd build` y build:demo: pasaron; advertencia no bloqueante del bundle privado ~555 kB.
- `node infra/scripts/e2e.mjs`: 31/31 Chromium, con axe y móvil.
- Revisión final detectó el caso de video asignado demasiado corto tras cambiar timing: se rechaza en resultado de dirección y followups detecta recursos incompatibles aun con assetId. Focal manual/voice/regeneration: 11/11, lint y API build/typecheck: pasaron.
- Se reforzó local-agent para probar respuesta perdida después del commit de registro LOCAL_ONLY, lectura del nonce persistido y recuperación sin duplicar. Root tsc y focal local-agent: 3/3, pasaron. `dev:agent doctor`: FFprobe 9.0.2 real, disco disponible, render=false.
- Tras el ajuste final del aviso de producción manual en wizard, web typecheck/build y E2E agents/manual/voice/projects-live: 4/4, pasaron sobre el API final.
- Migración real local 0118–0132 y reaplicación: pasaron, total132. Antes/después: user/projects/jobs/usage 0; assets/agentes/segmentos 0. No se creó propietario real.
- Diff revisado, git diff --check sin errores; sin env con valores ni medios/binarios en archivos Git. Pruebas efímeras limpias; solo se conserva el servidor previo 127.0.0.1:5173 (PID38068).

No se desplegó, creó recurso cloud, consumió proveedor ni hizo commit/push. Se conservaron los cambios previos F3/F4 en main (HEAD ef36f92). Pendientes conocidos: V02–V06/cloud/CPU/CI alojada/Linux, deuda de SDK, calidad de voz hablada, forced alignment y render. No hay bloqueos locales para revisar F5. Se detiene antes de F6-01.
