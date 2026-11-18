# Video Studio — sistema de generación de videos

F7-03 · 18 de noviembre de 2026. Recorridos AUTO/supervisados con mocks y render local real; backup/restore local aislado, integridad y recuperación. Montaje, QA, paquete YouTube y exportación disponibles. Integraciones externas MANUAL_ONLY y revisión humana explícita. Pilotos reales F7-04/F7-05 y despliegue aún no autorizados.

## Requisitos y arranque local

La operación y recuperación se describen en [OPERATIONS.md](docs/OPERATIONS.md): límites reales del software, diagnóstico, pausa/reanudación, backup offline y restore a una carpeta nueva. El agente añade `backup`, `verify-backup` y `restore`; requieren rutas absolutas y no reemplazan datos activos. Backup incluye D1/R2 locales y mediaRoot, con inventario SHA-256 y fingerprint del esquema; no incluye configuración del agente/secretos sueltos. D1 contiene datos privados, por lo que las copias deben guardarse fuera de Git en almacenamiento privado. Los comandos completos y el procedimiento de recuperación están en el runbook.

F7-02 se comprueba con `pnpm test tests/supervised-production.test.ts`: guion propio y fuentes, checkpoints, pausa/rechazo/reanudación, corrección localizada y MP4 real. F7-03/T22 usa `pnpm test tests/backup.test.ts tests/backup-restore.test.ts`: copia/restore aislado de D1/R2/media, versiones/referencias y render con checksum idéntico. El fixture nativo requiere los binarios indicados abajo; skip no equivale a validación. [Evidencia F7](docs/history/phase-7-validation.md).

La prueba integral de F7-01 se ejecuta con `pnpm test tests/auto-production.test.ts` (PowerShell: `pnpm.cmd`). Crea un propietario/proyecto efímeros, genera investigación/guion/dirección con mocks en AUTO y usa PNG/tono sintéticos propios. El fixture realiza las importaciones y aprobaciones explícitas vigentes, ejecuta el agente con Remotion/FFmpeg reales y verifica un MP4 de 5 s/150 frames, paquete y exportación con checksum. No convierte proveedores manual-only en autónomos ni verifica voz hablada o hechos. Requiere FFmpeg/FFprobe y Chromium locales existentes; informa skip si faltan, lo cual no valida T23. No usa datos reales, navegador de usuario, proveedores pagados ni créditos. [Evidencia F7-01](docs/history/phase-7-validation.md).

- Node.js **24.18.0**, fijado en `.node-version` y `engines`.
- pnpm **9.12.1**, fijado en `packageManager` y `engines`.
- Git para revisar cambios. No se necesita cuenta cloud, FFmpeg ni credenciales para estas tareas base.

Con esas versiones disponibles, ejecutar desde la raíz:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

En PowerShell, si la política del sistema bloquea `pnpm.ps1`, usar `pnpm.cmd` en todos esos comandos. No hace falta cambiar la política de ejecución. La instalación descarga herramientas públicas; Playwright descarga Chromium a su caché local una sola vez por versión. Las pruebas usan archivos locales y servidores en loopback, sin proveedores ni créditos. No es necesario copiar `.env.example` para estas validaciones.

Las dependencias directas tienen versiones exactas y `pnpm-lock.yaml` fija la resolución completa. `.npmrc` exige engines y peers compatibles. Al cambiar herramientas, verificar los requisitos declarados en el registro y repetir las validaciones; no actualizar el lockfile de forma incidental. Referencias oficiales: [pnpm](https://pnpm.io/installation), [typescript-eslint](https://typescript-eslint.io/getting-started/) y [Vitest](https://vitest.dev/guide/).

## Estructura y límites actuales

| Ruta | Destino acordado | Estado actual |
|---|---|---|
| `apps/web` | React/Vite/Tailwind/shadcn | Sesión/wizard, seguimiento y editores de contenido/versiones/scopes; demo separada |
| `apps/api` | Hono en Cloudflare Workers | Auth, CRUD, jobs/checkpoints, presupuesto y coordinador D1 local |
| `apps/local-agent` | Agente Node local | Pairing, bearer, heartbeat/claim, cache, FFprobe e importación LOCAL_ONLY |
| `packages/contracts` | Zod, DTO y enumeraciones | Proyectos, catálogo, jobs, revisión, proveedores y usage |
| `packages/domain` | Reglas puras | Duración, DAG, estados, readiness, backoff y checkpoints; sin I/O |
| `packages/providers` | Interfaces y adaptadores | Política y mocks deterministas de texto/dirección; sin adaptadores reales |
| `packages/render` | Composición Remotion | Composición declarativa y preview; render local con Remotion/FFmpeg |
| `packages/testkit` | Fixtures y builders | Proyectos sintéticos, UUIDs por índice y timestamp fijo |
| `infra/scripts` | Herramientas locales | Aviso de comandos pendientes |
| `tests` | Smoke, integración y E2E | Workspace, Worker real y shell web en Chromium |

Los workspaces son privados y sus enlaces usan `workspace:*`. Los paquetes compartidos exportan entradas TypeScript para herramientas y bundlers. `build` compila paquetes, genera estáticos Vite y el bundle de API con `wrangler deploy --dry-run`, sin publicar. Testkit, domain y render verifican tipos sin emitir; los consumidores resuelven sus fuentes. El CLI Node se empaqueta con Vite y una composición Remotion local. Providers ofrece mocks explícitos y catálogo de vías manuales, sin API externa activa.

## Paquete YouTube y exportación (F6-04)

Abre **YouTube** desde el proyecto o desde un render del historial. Solo se admite un render verificado con QA final aprobado. El título y capítulos iniciales proceden del guion y los frames de ese render; no se regeneran desde las versiones activas actuales. La propuesta es determinista, sin proveedor SEO ni IA: completa descripción, tags, ideas de miniatura y notas de divulgación. Revisa y confirma para guardar una versión inmutable. Editar crea otra versión; las anteriores se conservan. Los capítulos mantienen tiempos exactos en JSON y se muestran truncados a segundos para copiar. Revisa su idoneidad antes de publicar.

Puedes copiar cada campo y descargar metadata JSON. Para obtener también el MP4 en el equipo que lo produjo, usa el comando que muestra la pantalla, con una carpeta absoluta **nueva**:

```sh
pnpm dev:agent export --project <UUID> --package <UUID> --output "D:\EXPORTACIONES\mi-video-v1"
```

Requiere agente vinculado, API accesible y MP4 original con su recibo/checksum. Exporta `video.mp4`, `manifest.json`, `youtube.json` (paquete y contexto exactos) y `description.txt`. `COMPLETE.json` se escribe al terminar, con los checksums. Repetir un destino completo verifica los archivos sin sobrescribir; un archivo modificado produce `EXPORT_CHANGED`. Si falta el MP4, usa el equipo que lo generó; si falta espacio, libéralo. Si quedó una carpeta parcial sin COMPLETE, usa una carpeta nueva tras resolver el fallo; no se borra ni sobrescribe automáticamente. No copies una carpeta parcial como exportación final.

No publica en YouTube, abre carpetas ni sube multimedia a R2. El proyecto alcanza COMPLETED cuando el montaje activo vigente tiene render y paquete revisado; un paquete de otro montaje sigue accesible como histórico. [ADR 0015](docs/adr/0015-render-export-youtube.md).

## Montaje, QA y render local (F6-01 a F6-03)

Con guion y escenas aprobadas y recursos importados, abre **Montaje** en el proyecto. Crea un snapshot, revisa orden, encuadre, movimiento, transiciones y mezcla, y activa la candidata explícitamente. El preview usa recursos privados disponibles; los archivos LOCAL_ONLY requieren el equipo productor para renderizar.

En **QA**, analiza el snapshot y revisa hallazgos, fuentes, licencias, contenido y sincronía en el preview. Los bloqueos deben resolverse; las advertencias requieren aceptación editorial explícita. Una corrección localizada registra un trabajo sobre una escena/componente y conserva la versión activa. Máximo dos solicitudes por snapshot. Revisa/importa la candidata, actívala, crea otro montaje y repite QA.

En **Render**, solicita el MP4 Full HD aprobado. El agente vinculado debe estar ejecutando `pnpm dev:agent run`, con FFprobe, FFmpeg y Chromium existentes; `pnpm dev:agent doctor` comprueba disponibilidad. El build prepara la composición. `VIDEO_STUDIO_CHROME_PATH` permite elegir un Chromium local; no se descarga un navegador durante el render. El proyecto sigue en cola si el equipo se desconecta. No depende del navegador abierto.

La salida es MP4 H.264/AAC, 1920×1080, 30 fps y yuv420p; el agente normaliza y mide audio, decodifica la salida y comprueba frames negros/silencios. Un fallo registra diagnóstico e informe; un parcial no se publica. Reintentar vuelve a producir el snapshot exacto, conservando intentos. El MP4 aprobado permanece LOCAL_ONLY; la pantalla muestra checksum y el comando `pnpm dev:agent locate --project <UUID> --render <UUID>` para localizarlo. La exportación de F6-04 conserva el original; no hay copia automática a R2.

Los tests nativos requieren FFmpeg/FFprobe y Chromium instalados; indican skip si faltan. Usan imágenes y tonos propios de 10 segundos, sin proveedores ni voz hablada. Ver [evidencia F6](docs/history/phase-6-validation.md), [manifest](docs/adr/0012-render-manifests.md), [runner](docs/adr/0013-local-render-runner.md) y [QA](docs/adr/0014-snapshot-qa.md).

La base TS es estricta y no incorpora tipos Node por defecto. Browser añade DOM; API usa tipos Cloudflare sin mezclar lib WebWorker; contracts usa WebWorker para los tipos WHATWG URL requeridos por Zod, sin tipos Node. Agente y testkit usan Node. ESLint rechaza imports Node en web, API y paquetes compartidos de runtime.

## Web local (F1-03)

```sh
pnpm dev:web
# http://127.0.0.1:5173
```

`pnpm dev` inicia web y API local en paralelo; Ctrl+C detiene ambos. La web normal usa sesión y proyectos persistidos; preparar el acceso con los pasos de «Acceso privado local» de este README. La demostración explícita (`--mode demo`) presenta fixtures en `apps/web/src/fixtures.ts`, sin sesión, persistencia, producción ni costos reales.

La demostración incluye todas las rutas de `docs/UX.md`, sidebar plegable con foco/tooltips, páginas de trabajo, búsqueda/estado/orden en proyectos, secciones de proyecto, 24 escenas de ejemplo paginadas y detalle de escena. Sus acciones de negocio son vistas preparadas sin efectos. La vista privada conecta login, wizard y coordinación con la API real. Los identificadores y estados de la demo son datos de presentación, no DTO de API.

El selector **Estado de vista** permite revisar datos, skeleton, vacío, error recuperable, acceso denegado y 404 en cualquier ruta. Se representa en `?view=ready|loading|empty|error|denied|notfound`; búsqueda, filtros y página también usan URL para conservarse en recargas y navegación. La desconexión del navegador muestra una alerta persistente sin cambiar los datos de muestra. No se implementa caché offline para arrancar la aplicación sin conexión.

Tema oscuro con tokens UX, Tailwind y botón shadcn/ui adaptado con Radix Slot/CVA; configuración de componentes en `apps/web/components.json`. Miniaturas ilustrativas hechas con CSS, sin videos ni imágenes externas. Interfaz en español, foco visible, salto al contenido, estados con texto/icono y movimiento reducido.

React/DOM `19.3.1`, React Router `7.18.5`, Vite `8.3.8`, plugin React `6.3.0`, Tailwind `4.3.5`, Playwright `1.65.1` y axe Playwright `4.14.0` quedan fijados. Los E2E compilan y prueban los estáticos mediante preview aislado en `127.0.0.1:4173` (el puerto debe estar libre), con rutas directas/recarga, filtros, estados, escenas, teclado, offline y móvil. Capturas y trazas quedan en `test-results/`, ignorado por Git. Axe comprueba reglas WCAG A/AA en vistas representativas; no sustituye una auditoría de accesibilidad completa. Referencias: [Tailwind/Vite](https://tailwindcss.com/docs/installation/using-vite), [shadcn/ui](https://ui.shadcn.com/docs/components/button), [React Router](https://reactrouter.com/start/declarative/installation) y [Playwright](https://playwright.dev/docs/test-configuration).

Para servir una compilación SPA en otro entorno, el servidor deberá redirigir las rutas del cliente a `index.html`; no se configura hosting ni se despliega en esta tarea.

## API local (F1-02)

```sh
pnpm dev:api
```

Escucha solo en `http://127.0.0.1:8787` mediante Wrangler `--local`. Detener con Ctrl+C. Configuración en `infra/wrangler.local.json`: entorno `local`, versión `0.0.0`, bindings D1/R2 locales con `remote:false`, sin secretos en Git. Las rutas de diagnóstico no requieren login. `APP_ENV` y `APP_VERSION` se validan al recibir cada request; si faltan o son inválidas, devuelve 503 sin fallback a producción. Health sigue siendo liveness, no comprueba DB.

- `GET /api/v1/health`: `{ "status": "ok" }`, solo liveness del Worker.
- `GET /api/v1/version`: `{ "apiVersion": "v1", "version": "0.0.0" }`.
- Errores 404/500/503 con sobre compartido, UUID por request y mensajes seguros. Véase `docs/API.md`.

`pnpm test` genera primero el bundle de API y ejecuta pruebas en Miniflare/workerd local, además de errores de aplicación y smoke del workspace. El test de excepción añade una ruta solo a su instancia de prueba; el Worker real no expone endpoints de fallo.

Wrangler `4.115.0`, Miniflare `4.20260722.1`, tipos Cloudflare `5.20260722.1` y fecha de compatibilidad `2026-07-22` quedan fijados para usar la línea estable de Miniflare 4. Los tipos publicados del SDK Miniflare contienen referencias internas ausentes: su carga en el test usa una interfaz local estrecha para los métodos ejercitados, sin parchear dependencias ni activar `skipLibCheck`. Es deuda de herramientas a revisar al actualizar el SDK. Referencia: [pruebas locales con Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/get-started/).

## Contratos, dominio y CI (F1-04)

`packages/contracts` exporta los esquemas Zod y tipos de `ProjectInput`, `ProjectSettings`, `ProjectDto`, UUID, UTC, duración/revisión, instrucciones y paginación. La API de diagnóstico conserva su wire v1; los endpoints privados y el wizard de F2-03 usan contratos compartidos adicionales sin modificar el DTO base.

`createProjectInputSchema({maxInputBytes})` limita el texto bruto en UTF-8 antes de recortar espacios: default propuesto **1 MiB**, configurable desde código confiable. Título 1–200, instrucciones 0–4000, duración entera positiva y presupuesto entero seguro no negativo. `safeValidationIssues` produce como máximo 20 errores por campo con mensaje genérico, sin valores del usuario ni stack. Los límites secundarios y las reglas concretas están en `docs/API.md`; esta validación no autoriza referencias, gasto ni proveedores.

`sumDurationMs` suma duraciones enteras positivas y rechaza overflow; para una lista vacía devuelve 0 como suma neutral. El módulo `orchestration` añade DAG, estados y planificación pura, sin montaje ni render. Testkit ofrece builders con objetos nuevos por llamada, timestamp fijo e IDs deterministas para pruebas; no genera identidades de producción ni simula proveedores integrados.

CI está declarado en `.github/workflows/ci.yml`: GitHub Actions con Node de `.node-version`, pnpm de `packageManager`, instalación congelada, lint, typecheck, test, build y E2E Chromium en Ubuntu/Windows. Acciones fijadas a commits, permisos de lectura, sin despliegue ni secretos. Los tests exclusivos están prohibidos bajo `CI=true`. El respaldo inicial en GitHub usó `[skip ci]`; CI alojada y Linux no se han ejecutado. Las ejecuciones remotas y sus posibles costos requieren autorización. El workflow se validó localmente con actionlint; las comprobaciones de código se ejecutan en Windows. Referencias: [setup-node](https://github.com/actions/setup-node), [pnpm/action-setup](https://github.com/pnpm/action-setup) y [actionlint](https://github.com/rhysd/actionlint).

## D1 local y repositorios (F2-01)

```sh
pnpm db:migrate:local
```

Usa siempre Wrangler `--local` y el binding `DB` de `infra/wrangler.local.json`, con ID nulo de desarrollo y `remote:false`. No crea recursos cloud ni requiere login. Las migraciones 0001–0005 son aditivas, numeradas y forward-only; Wrangler registra las aplicadas, de modo que repetir el comando no las ejecuta de nuevo. El estado local queda en `infra/.wrangler/state/v3/d1`, ignorado por Git. No borrar ese directorio como forma de actualizar una base existente.

Repositorios internos en `apps/api/src/db`: identidad de solo lectura, creación atómica de borrador/settings, get/list por propietario y lectura de settings. `createRepositories` comprueba la compatibilidad con el binding D1 nativo. SQL usa parámetros enlazados, FK/constraints y validación Zod al escribir/leer; las listas no cargan texto de entrada largo. CRUD, edición y archivo lógico se completaron en F2-03. Los usuarios sintéticos se insertan solo en bases efímeras de pruebas; no se ha creado un propietario real local.

`user` conserva el modelo core de Better Auth. Sesiones, cuentas, bootstrap y compatibilidad local V01 se completaron en F2-02; cada ruta de proyecto autentica y autoriza al propietario. Fundación inicial en [ADR D1](docs/adr/0001-local-d1-foundation.md).

Las pruebas D1 usan bases efímeras independientes del estado de desarrollo; aplican el mismo SQL y verifican creación desde vacío, upgrade con datos existentes, constraints/índices/FK, rollback de batch, scopes, paginación y errores seguros. No se necesita migrar la base de desarrollo para ejecutar `pnpm test`.

## Acceso privado local (F2-02)

`pnpm local:setup` crea o conserva secretos aleatorios **fuera del repo**, bajo el perfil local del usuario. `VIDEO_STUDIO_ENV_FILE` permite elegir otro archivo externo. No imprime valores ni crea una cuenta. Ejecuta `pnpm db:migrate:local`, `pnpm dev` y, en otra terminal interactiva, `pnpm owner:bootstrap`: pide nombre, correo y contraseña oculta. Conserva el archivo privado para reintentar el mismo bootstrap después de un fallo. No usar credenciales reales en pruebas ni compartir ese archivo.

`dev:api` carga ese archivo con Wrangler local y reduce logs para no imprimir bindings privados. El Origin configurado debe coincidir con la web (`http://127.0.0.1:5173`); la API no habilita CORS. Better Auth real usa D1 y cookies HttpOnly/SameSite=Lax, Secure en HTTPS; HTTP se permite únicamente en loopback local. No hay registro público. `/api/v1/me` solo devuelve identidad segura. La web normal conecta login y CRUD; F1 se conserva como demo explícita. [ADR y límites](docs/adr/0002-better-auth-local.md).

## Proyectos privados (F2-03)

La web normal ahora inicia sesión y usa la API: crear, listar, buscar/filtrar, editar borradores y archivar con confirmación. El wizard guarda cada paso (incluido Atrás), detecta conflictos de revisión y protege cambios sin guardar. El presupuesto se introduce como microunidades enteras; no autoriza consumo real. Estilo v1, modalidad y modo se guardan para las fases de dirección/scheduler. No hay producción ni proveedores conectados.

`pnpm --filter @video-studio/web dev --mode demo` abre la demostración F1 explícita. `build:demo` genera `dist-demo`; `preview` sirve esa demostración en 4173. `pnpm test:e2e` comprueba la demo y el flujo privado real separado en 4174, contra D1/workerd efímero en 8788. Las credenciales de fixture se generan por ejecución, solo en memoria. Las migraciones 0016–0018 añaden paso de wizard, control de mutación y recibos de idempotencia; no borran registros.

## Catálogo versionado (F2-04)

Migraciones 0019–0064 y repositorios internos para investigación/fuentes, guion, escenas/versiones, tomas y assets/enlaces. FK dentro del mismo proyecto/propietario, payloads inmutables, hashes y activación explícita con revisión y parent exacto. Crear candidatas conserva la activa y el historial. El catálogo base admite metadatos MISSING; F4 conecta editores/invalidación y F5 publica archivos verificados con R2 local o LOCAL_ONLY. [Alcance y límites](docs/adr/0003-catalog-versions.md).

## Orquestación y seguimiento (F3-01 a F3-04)

Desde un borrador confirmado puedes registrar el trabajo inicial, consultar Generaciones, intentos y recursos pendientes, pausar/reanudar coordinación y revisar una versión exacta. El inicio/reintento/pausa/aprobación son idempotentes; una revisión antigua devuelve 409. La UI no declara un porcentaje total del video cuando solo conoce los trabajos registrados. Polling cada 5 s con backoff hasta 30 s, detenido en pestaña oculta/offline y reanudado al volver; las acciones siguen guardadas en D1 al cerrar el navegador.

Leases de 90 s con fencing por intento, recuperación de vencidos y resultados UNKNOWN bloqueados hasta reconciliación verificada. Hay handler `scheduled` y coordinador acotado sin dependencia del frontend; **no hay cron cloud configurado**. Se necesita un disparador de servidor autorizado para invocar ticks periódicos. F4 añade ejecutores exclusivamente mock; una vía no integrada queda en WAITING_MANUAL/RESOURCE sin fingir producción. [Orquestación](docs/adr/0004-d1-orchestration.md).

Proveedores permite guardar vías manuales y prioridades; no solicita credenciales ni habilita APIs de pago. Capacidades, cuotas, presupuesto entero en microunidades y ledger RESERVED/SETTLED/RELEASED/UNKNOWN están probados con cotizaciones sintéticas. Configs MOCK solo en fixtures explícitas, sin adaptadores reales. F5 conecta la importación manual de resultados. [Política de presupuesto](docs/adr/0005-provider-budget-policy.md).

Migraciones locales hasta 0109, aditivas. `pnpm test:e2e` prueba demo y sesión privada separadas con 26 jobs de simulación en D1 efímero; no los inserta en tu base de desarrollo. El propietario real sigue requiriendo el bootstrap interactivo descrito arriba. No hay despliegue, gasto, commit ni push de Fase 3.

## Contenido y edición (F4-01 a F4-04)

La vista privada de cada proyecto enlaza Investigación, Guion y Escenas/Dirección. Puedes guardar fuentes propias y notas, claims trazables, guion por secciones, narración, prompts, cámara, intención musical y continuidad. Guardar crea una candidata; comparar y activar requiere confirmación y revisión vigente. Las versiones antiguas se conservan. Escenas se paginan de 25 en 25 con tiempos orientativos y storyboard: no se presenta multimedia inexistente como preview real.

Regenerar permite elegir escena completa, visual, narración, voz, música, ambiente o montaje, con instrucción y proveedor compatible. La activa se conserva hasta aprobar la candidata, incluso en AUTO cuando se solicita regeneración. Activar compara componentes, marca dependientes STALE y preserva recursos independientes; voz nueva afecta sincronización. Cambiar el guion es una operación global con confirmación de impacto. No se borran versiones, recursos ni snapshots históricos.

Solo fixtures internas pueden configurar MOCK_FIXTURE. Los mocks no investigan la web ni inventan afirmaciones: conservan referencias aportadas como no verificadas. El director aplica modalidad, presets versionados, biblia visual y varias tomas con suma de duración exacta. Los agentes registran modelo/prompt/simulación en JSON v1 y permiten una sola reparación estructural. Publicación, lease, intento, reserva y checkpoint son atómicos. La configuración normal sigue ofreciendo vías manuales, sin gasto ni API pagada habilitada.

Migraciones aditivas hasta 0117; fanout y trabajos siguientes se retoman desde D1 después de un corte. F5 añade archivos, agente y voz con tiempos revisables; montaje real y render quedan para F6. [Decisiones](docs/adr/0006-content-publication-invalidation.md) y [evidencia](docs/history/phase-4-validation.md). No hay deploy ni commit/push de F3/F4.

## Agente local e importación (F5)

La biblioteca privada importa PNG/JPEG/WebP/WAV con metadatos y checksum; MP3/Ogg/MP4 quedan pendientes de inspección por el agente. Límite web: 5 MiB. R2 es exclusivamente local/emulado. Licencia/procedencia y derechos deben confirmarse; no se presupone permiso comercial. Los enlaces de preview exigen sesión y caducan. Un recurso local sin copia remota se identifica como LOCAL_ONLY.

```sh
pnpm dev:agent doctor
pnpm dev:agent pair --url http://127.0.0.1:8787 --name "Mi equipo"
pnpm dev:agent run
```

Crear primero el código temporal desde Configuración en la sesión privada y escribirlo en la consola interactiva. El token se guarda en `%LOCALAPPDATA%/VideoStudio/agent.json`, fuera del repo. `VIDEO_STUDIO_AGENT_CONFIG` permite otro archivo externo; no compartirlo. Revocar desde Configuración bloquea su acceso. El agente funciona sin navegador y no recibe comandos shell. `run --once` permite un ciclo diagnóstico.

FFprobe debe estar instalado: `--ffprobe` o `VIDEO_STUDIO_FFPROBE_PATH` seleccionan el ejecutable. `doctor` indica su disponibilidad y espacio libre. En este equipo se verificó una distribución portable Windows 9.0.2 fuera de Git; [procedencia, hash y límites](docs/adr/0008-local-agent.md). No hay render aún ni integración pagada. El agente inspecciona medios y reclama únicamente tipos implementados.

Para registrar un archivo que permanezca local (hasta 2 GiB/6 h), usar una ruta absoluta explícita:

```sh
pnpm dev:agent import --file "D:\Medios\voz.wav" --project UUID_DEL_PROYECTO --mime audio/wav --source "Archivo propio con derechos" --rights
```

No transmite el path ni sube el archivo. Devuelve UUID, checksum, duración y LOCAL_ONLY. Si falla la red, repetir `pnpm dev:agent import` recupera el cuerpo/nonce pendiente. Cache/configuración se conservan fuera del repo; no borrar versiones anteriores para reintentar. Web preview requiere una copia remota explícita; archivos grandes quedan locales.

Desde Generaciones → **Aportar resultado manual**, copiar prompt/referencias, producir con la herramienta propia e importar JSON o archivos. La API valida estado, hashes, propiedad, tipo/duración y licencia. Investigación reanuda el siguiente trabajo; guion/escenas/asignaciones crean candidata para aprobación explícita. El coordinador retoma sucesores desde D1: el navegador no ejecuta el pipeline. En desarrollo aún se necesita un disparador de servidor para ticks periódicos; no se ha desplegado cron cloud.

Para voz, seleccionar un audio verificado en el trabajo VOICE. Sin `segments`, se generan tiempos **ESTIMATED**, pendientes de revisión auditiva; no hay reconocimiento del habla. Para tiempos propios, usar en el JSON `segments: [{segmentIndex: 0, text: "Narración exacta", startMs: 0, endMs: 1200}]`, dentro de la duración real y cubriendo toda la narración. El editor muestra los tiempos y conserva la activa hasta aprobar. Nueva voz recalcula tomas e invalida derivados al activarse. [Decisión y límites](docs/adr/0010-voice-timing.md).

Proveedores muestra la revisión oficial de texto/imagen/video/voz/stock. Son vías **MANUAL_ONLY**; no se asume que una suscripción permita llamadas API ni que sus créditos estén habilitados en este proyecto. No hay voz hablada automática: el mock produce un tono de fixture. [Investigación de integraciones y requisitos futuros](docs/adr/0011-provider-integration-review.md).

## Archivos privados y entorno

`.env.example` contiene únicamente nombres sin valores. Los archivos privados `.env*` y `.dev.vars*`, dependencias, builds, estado de Wrangler, bases locales y formatos multimedia habituales están ignorados. Guardar medios locales bajo `media/`, `renders/` o fuera del repositorio, y credenciales fuera del repo. No hay recursos cloud ni configuración de producción en esta entrega.

## Continuar con Codex

Leer `AGENTS.md` y `docs/STATUS.md` antes de cada tarea. El alcance vigente termina en F5-05; detenerse antes de F6-01 salvo nueva autorización. `START_CODEX.md` conserva el prompt del paquete documental inicial.

## Documentos y precedencia
| Archivo | Contenido |
|---|---|
| AGENTS.md | Mandato operativo de Codex |
| docs/PRODUCT.md | MVP, requisitos, criterios de producto |
| docs/UX.md | Mapa de pantallas, estados, interacciones |
| docs/ARCHITECTURE.md | Stack, componentes, entornos y monorepo |
| docs/DATA.md | Modelo lógico, integridad, migraciones |
| docs/API.md | Contratos REST y protocolo agente local |
| docs/PIPELINE.md | DAG, agentes, prompts, trabajos/versiones |
| docs/PROVIDERS.md | Integraciones, costos, manual asistido |
| docs/SECURITY.md | Amenazas, credenciales, privacidad y resiliencia |
| docs/TESTING.md | Pruebas y aceptación integral |
| docs/ROADMAP.md | Fases y tareas ejecutables |
| docs/STATUS.md | Estado vivo y handoff |
| docs/DECISIONS.md | Decisiones consolidadas y pendientes de validación |

Las decisiones previamente aprobadas son la base. Los detalles de implementación nuevos de esta especificación son defaults propuestos para ejecución, no afirmaciones de que integraciones externas funcionan. Si hay conflicto, prevalece una nueva decisión explícita del propietario; registrar ADR y actualizar los contratos. Ningún documento sustituye pruebas reales de compatibilidad.
