# Evidencia histórica de Fase 1 — F1-01 a F1-03

Archivada desde STATUS el 2026-11-17 para mantener breve el handoff. Evidencia original sin modificar; describe el estado al cierre de cada tarea.

## Evidencia F1-01
- Entorno comprobado: Windows/PowerShell, Node `24.18.0`, pnpm `9.12.1` mediante `pnpm.cmd` (el shim `.ps1` está bloqueado por política del sistema; no se cambió).
- `pnpm.cmd install` y `pnpm.cmd install --frozen-lockfile`: PASÓ; nueve proyectos contando raíz, ocho workspaces privados. TypeScript `5.9.3`, ESLint `10.13.0`, typescript-eslint `8.73.0`, Vitest `5.1.0`, Vite `8.3.8`; versiones exactas y peers/engines comprobados.
- `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd test` y `pnpm.cmd build`: PASÓ. Dos smoke tests: descubrimiento de workspaces y resolución de importación TS interna. Build solo emite módulos vacíos, declaraciones y mapas.
- `dev`, `dev:web`, `dev:api`, `dev:agent`, `test:e2e`, `db:migrate:local`, ejecutados con `pnpm.cmd`: código 1 y aviso de tarea pendiente en los seis casos, como se diseñó. E2E real NO EJECUTADO: aún no hay UI.
- Selección preliminar corregida antes del cierre: ESLint 9 fuera de soporte; typecheck falló con Vite 7/Vitest 5 por export de tipos ausente. La combinación final pasa con `skipLibCheck:false`.
- Revisión de archivos/diff inicial y reglas ignore: sin secretos, medios, bases, dependencias ni builds en archivos candidatos a Git. Sin staging, commit, remoto, despliegue ni cambios a otras especificaciones.
- Pendientes previstos: aplicación Worker F1-02, UI F1-03, contratos/dominio/testkit funcional y CI F1-04. Validación de entorno y tipos específicos Cloudflare llegará con F1-02; exports de scaffolding apuntan a TS fuente. Ningún proveedor simulado se presenta como integrado.

## Evidencia F1-02
- Archivos: `apps/api/{src,package.json,tsconfig.json}`, `infra/wrangler.local.json`, `packages/contracts`, `tests/api-*.test.ts`, scripts/dependencias raíz, lockfile, `.env.example`, README y sección de diagnóstico API. Sin cambios en arquitectura ni tareas futuras.
- `pnpm.cmd install` / `pnpm.cmd install --frozen-lockfile`, `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd build`, `pnpm.cmd test`: PASÓ. 15 pruebas: 8 Worker real local, 5 errores/configuración/contrato y 2 smoke de workspace. Build Worker usa exclusivamente `deploy --dry-run`; no publica.
- `pnpm.cmd dev:api`: arranque en loopback; HTTP GET health/version mediante `Invoke-WebRequest`: 200, payloads esperados y JSON UTF-8; salida `x` de Wrangler: cierre correcto con código 0.
- Contratos iniciales Zod de health/version/error, sin DTO de negocio previo ni persistencia que migrar. 404/500/503 con UUID de servidor, no-store y mensajes seguros. Sin rutas de negocio, CORS, cookies o secretos; health es liveness.
- Herramientas finales: Hono `4.13.19`, Zod `4.6.7`, Wrangler `4.115.0`, Miniflare `4.20260722.1`, tipos Cloudflare `5.20260722.1`, compatibility date `2026-07-22`. Instalación exige peers compatibles.
- Fallos corregidos: header JSON sin charset; tipos WHATWG URL requeridos por Zod; selección de tipos Cloudflare/peers. SDK Wrangler/Miniflare publica .d.ts incompletos, también en la línea estable: el test carga Miniflare real con una interfaz local estrecha del SDK, sin parchear dependencias ni activar `skipLibCheck`. Revisar esta limitación al actualizar herramientas; no se ocultan errores del código propio.
- Revisión de diff contra copia previa a F1-02 (repo aún sin commit), sin cambios ajenos ni secretos. Sin staging, commit, push, despliegue ni gasto. E2E de UI NO EJECUTADO: UI aún pendiente.

## Evidencia F1-03
- Archivos: `apps/web` (React/Vite, router, CSS/tokens, botón shadcn adaptado, fixtures y estados), `playwright.config.ts`, `tests/e2e/shell.spec.ts`, scripts/dependencias raíz, lockfile, configuración TS/lint, README y STATUS. API, contratos y arquitectura sin cambios.
- `pnpm.cmd install` / `pnpm.cmd install --frozen-lockfile`, `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd build`: PASÓ. `pnpm.cmd test`: 15/15; `pnpm.cmd test:e2e`: 24/24. Chromium instalado con `pnpm.cmd exec playwright install chromium` en caché externa al repo.
- E2E sobre build estático: rutas/recarga directa, búsqueda/filtros/orden en URL, paginación 24 escenas, detalle/atrás, skeleton/vacío/error/reintento/denegado/404, sidebar por teclado, foco/tooltips/Escape y hover persistente, offline/reconexión y ancho móvil sin overflow. Sin servicios de pago ni datos reales.
- Axe: 0 infracciones A/AA detectadas en proyectos escritorio/móvil y escenas escritorio; no constituye auditoría completa. Capturas inspeccionadas en `test-results/` (ignorado): `proyectos-desktop.png`, `escenas-desktop.png`, `proyectos-mobile.png` dentro de la carpeta de la prueba visual.
- `pnpm.cmd dev`: web `127.0.0.1:5173` y API `127.0.0.1:8787`; smoke HTTP con `Invoke-WebRequest`: ambos 200. Detención intencional con Ctrl+C (pnpm retorna 1 por interrupción, no por fallo de arranque); servidores detenidos al terminar.
- Correcciones previas al cierre: import sin uso, libs DOM de herramientas E2E y expectativa de orden alfabético del test. TS estricto y `skipLibCheck:false` conservados; imports Node también restringidos en TSX de web.
- Límites: datos de presentación sintéticos, sin nuevos DTO de negocio ni migraciones; login/wizard/editores/generación son vistas preparadas con acciones inhabilitadas y motivo. Agente sin conectar, sin llamadas web a API, credenciales, subida de archivos o persistencia. La alerta offline no implementa arranque offline ni service worker.
- Diff revisado contra copia previa a F1-03 por ausencia de commits; sin secretos, medios pesados, builds ni artefactos de prueba candidatos a Git. Sin staging/commit/push, despliegue, costos ni tareas posteriores.

Estado actual: [STATUS](../STATUS.md).
