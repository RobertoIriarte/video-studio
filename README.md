# Video Studio — sistema de generación de videos

Fase 2 · 17 de noviembre de 2026. Sesión Better Auth, CRUD/wizard persistido y catálogo versionado D1 local. La producción multimedia y el agente funcional siguen pendientes. Prioridad: videos largos para YouTube con calidad, intervención selectiva, automatización compatible con proveedores y alojamiento económico.

## Requisitos y arranque local

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
| `apps/web` | React/Vite/Tailwind/shadcn | Shell oscuro, router, vistas y estados con fixtures |
| `apps/api` | Hono en Cloudflare Workers | Diagnóstico y repositorios internos D1 locales |
| `apps/local-agent` | Agente Node local | Módulo TS vacío, configuración Node |
| `packages/contracts` | Zod, DTO y enumeraciones | Diagnóstico/error, primitivas, proyectos y paginación base |
| `packages/domain` | Reglas puras | Suma exacta de duraciones, sin I/O ni dependencias runtime |
| `packages/providers` | Interfaces y adaptadores | Módulo vacío, sin proveedores conectados |
| `packages/render` | Composición Remotion | Módulo vacío, sin renderizador |
| `packages/testkit` | Fixtures y builders | Proyectos sintéticos, UUIDs por índice y timestamp fijo |
| `infra/scripts` | Herramientas locales | Aviso de comandos pendientes |
| `tests` | Smoke, integración y E2E | Workspace, Worker real y shell web en Chromium |

Los workspaces son privados y sus enlaces usan `workspace:*`. Los paquetes compartidos exportan entradas TypeScript para herramientas y bundlers. `build` compila paquetes, genera estáticos Vite y el bundle de API con `wrangler deploy --dry-run`, sin publicar. Testkit es un paquete de desarrollo con exports TS fuente: su build verifica tipos sin emitir artefactos. Agente, providers y render siguen como módulos vacíos; no representan integraciones funcionales.

La base TS es estricta y no incorpora tipos Node por defecto. Browser añade DOM; API usa tipos Cloudflare sin mezclar lib WebWorker; contracts usa WebWorker para los tipos WHATWG URL requeridos por Zod, sin tipos Node. Agente y testkit usan Node. ESLint rechaza imports Node en web, API y paquetes compartidos de runtime.

## Web local (F1-03)

```sh
pnpm dev:web
# http://127.0.0.1:5173
```

`pnpm dev` inicia web y API local en paralelo; Ctrl+C detiene ambos. La web normal usa sesión y proyectos persistidos; preparar el acceso con los pasos de «Acceso privado local» de este README. La demostración explícita (`--mode demo`) presenta fixtures en `apps/web/src/fixtures.ts`, sin sesión, persistencia, producción ni costos reales.

La demostraci?n incluye todas las rutas de `docs/UX.md`, sidebar plegable con foco/tooltips, páginas de trabajo, búsqueda/estado/orden en proyectos, secciones de proyecto, 24 escenas de ejemplo paginadas y detalle de escena. Login, wizard, editores y acciones de producción son vistas preparadas sin funcionalidad de negocio. Los identificadores y estados de los fixtures son datos de presentación, no nuevos DTO de API.

El selector **Estado de vista** permite revisar datos, skeleton, vacío, error recuperable, acceso denegado y 404 en cualquier ruta. Se representa en `?view=ready|loading|empty|error|denied|notfound`; búsqueda, filtros y página también usan URL para conservarse en recargas y navegación. La desconexión del navegador muestra una alerta persistente sin cambiar los datos de muestra. No se implementa caché offline para arrancar la aplicación sin conexión.

Tema oscuro con tokens UX, Tailwind y botón shadcn/ui adaptado con Radix Slot/CVA; configuración de componentes en `apps/web/components.json`. Miniaturas ilustrativas hechas con CSS, sin videos ni imágenes externas. Interfaz en español, foco visible, salto al contenido, estados con texto/icono y movimiento reducido.

React/DOM `19.3.1`, React Router `7.18.5`, Vite `8.3.8`, plugin React `6.3.0`, Tailwind `4.3.5`, Playwright `1.65.1` y axe Playwright `4.14.0` quedan fijados. Los E2E compilan y prueban los estáticos mediante preview aislado en `127.0.0.1:4173` (el puerto debe estar libre), con rutas directas/recarga, filtros, estados, escenas, teclado, offline y móvil. Capturas y trazas quedan en `test-results/`, ignorado por Git. Axe comprueba reglas WCAG A/AA en vistas representativas; no sustituye una auditoría de accesibilidad completa. Referencias: [Tailwind/Vite](https://tailwindcss.com/docs/installation/using-vite), [shadcn/ui](https://ui.shadcn.com/docs/components/button), [React Router](https://reactrouter.com/start/declarative/installation) y [Playwright](https://playwright.dev/docs/test-configuration).

Para servir una compilación SPA en otro entorno, el servidor deberá redirigir las rutas del cliente a `index.html`; no se configura hosting ni se despliega en esta tarea.

## API local (F1-02)

```sh
pnpm dev:api
```

Escucha solo en `http://127.0.0.1:8787` mediante Wrangler `--local`. Detener con Ctrl+C. Configuración en `infra/wrangler.local.json`: entorno `local`, versión `0.0.0`, binding D1 local sin recurso cloud, sin R2 ni secretos. Las rutas de diagnóstico no requieren login. `APP_ENV` y `APP_VERSION` se validan al recibir cada request; si faltan o son inválidas, devuelve 503 sin fallback a producción. Health sigue siendo liveness, no comprueba DB.

- `GET /api/v1/health`: `{ "status": "ok" }`, solo liveness del Worker.
- `GET /api/v1/version`: `{ "apiVersion": "v1", "version": "0.0.0" }`.
- Errores 404/500/503 con sobre compartido, UUID por request y mensajes seguros. Véase `docs/API.md`.

`pnpm test` genera primero el bundle de API y ejecuta pruebas en Miniflare/workerd local, además de errores de aplicación y smoke del workspace. El test de excepción añade una ruta solo a su instancia de prueba; el Worker real no expone endpoints de fallo.

Wrangler `4.115.0`, Miniflare `4.20260722.1`, tipos Cloudflare `5.20260722.1` y fecha de compatibilidad `2026-07-22` quedan fijados para usar la línea estable de Miniflare 4. Los tipos publicados del SDK Miniflare contienen referencias internas ausentes: su carga en el test usa una interfaz local estrecha para los métodos ejercitados, sin parchear dependencias ni activar `skipLibCheck`. Es deuda de herramientas a revisar al actualizar el SDK. Referencia: [pruebas locales con Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/get-started/).

## Contratos, dominio y CI (F1-04)

`packages/contracts` exporta los esquemas Zod y tipos de `ProjectInput`, `ProjectSettings`, `ProjectDto`, UUID, UTC, duración/revisión, instrucciones y paginación. La API de diagnóstico conserva su wire v1; los endpoints privados y el wizard de F2-03 usan contratos compartidos adicionales sin modificar el DTO base.

`createProjectInputSchema({maxInputBytes})` limita el texto bruto en UTF-8 antes de recortar espacios: default propuesto **1 MiB**, configurable desde código confiable. Título 1–200, instrucciones 0–4000, duración entera positiva y presupuesto entero seguro no negativo. `safeValidationIssues` produce como máximo 20 errores por campo con mensaje genérico, sin valores del usuario ni stack. Los límites secundarios y las reglas concretas están en `docs/API.md`; esta validación no autoriza referencias, gasto ni proveedores.

`sumDurationMs` suma duraciones enteras positivas y rechaza overflow; para una lista vacía devuelve 0 como suma neutral. No implementa DAG, estados, montaje ni render. Testkit ofrece builders con objetos nuevos por llamada, timestamp fijo e IDs deterministas para pruebas; no genera identidades de producción ni simula proveedores integrados.

CI queda preparado como default reversible en `.github/workflows/ci.yml`: GitHub Actions con Node de `.node-version`, pnpm de `packageManager`, instalación congelada, lint, typecheck, test, build y E2E Chromium en Ubuntu/Windows. Acciones fijadas a commits, permisos de lectura, sin credenciales persistidas, despliegue ni secretos. Los tests exclusivos están prohibidos bajo `CI=true`. Configurarlo no ejecuta jobs: no hay remoto ni push; las ejecuciones alojadas y sus posibles costos requieren la autorización correspondiente. Se valida localmente el workflow con actionlint y los comandos del proyecto en Windows; no se presenta una ejecución alojada o Linux como verificada. Referencias: [setup-node](https://github.com/actions/setup-node), [pnpm/action-setup](https://github.com/pnpm/action-setup) y [actionlint](https://github.com/rhysd/actionlint).

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

Migraciones 0019–0064 y repositorios internos para investigación/fuentes, guion, escenas/versiones, tomas y assets/enlaces. FK dentro del mismo proyecto/propietario, payloads inmutables, hashes y activación explícita con revisión y parent exacto. Crear candidatas conserva la activa y el historial. Assets nace MISSING: no hay archivos cargados ni conexión R2. Editores, invalidación de derivados e importación se implementarán en sus fases. [Alcance y límites](docs/adr/0003-catalog-versions.md).

## Comandos pendientes reservados

Los siguientes scripts están reservados y devuelven **código 1** con la tarea pendiente; no arrancan servicios ni ejecutan migraciones:

| Comando | Habilitación prevista |
|---|---|
| `pnpm dev:agent` | F5-02 |

`.env.example` contiene únicamente nombres sin valores. Los archivos privados `.env*` y `.dev.vars*`, dependencias, builds, estado de Wrangler, bases locales y formatos multimedia habituales están ignorados. Guardar medios locales bajo `media/`, `renders/` o fuera del repositorio, y credenciales fuera del repo. No hay recursos cloud ni configuración de producción en esta entrega.

## Continuar con Codex

Leer `AGENTS.md` y `docs/STATUS.md` antes de cada tarea. El alcance vigente termina en F2-04; F3-01 requiere la siguiente autorización. `START_CODEX.md` conserva el prompt del paquete documental inicial.

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
