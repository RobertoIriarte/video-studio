# Plan de implementación — tareas acotadas para Codex

Ejecutar en orden de dependencias; cada tarea se revisa antes de comenzar. No implementar todo en una sesión. F0 planificación especificada, pendiente aprobación del paquete. F1-01 es siguiente tras aprobación. Mocks por defecto; gasto/despliegue real requieren autorización. Las fases son incrementos verificables; no asumir fechas.

| ID | Tarea y entregable | Dependencia | Criterio de aceptación |
|---|---|---|---|
| F1-01 | Inicializar monorepo, pnpm workspace, TS base strict, gitignore, env.example, scripts, README arranque | F0 | Estructura ARCHITECTURE; instalación reproducible, lint/typecheck/test/build básicos; sin credenciales |
| F1-02 | Skeleton API Hono Worker health/version y errores; config local | F1-01 | `/api/v1/health` y contratos error, test Worker local |
| F1-03 | Shell React/Vite, Tailwind/shadcn, router y dark UI, fixtures | F1-01 | Navegación funcional y estados UX, build |
| F1-04 | Contratos Zod base, dominio puro, testkit y CI | F1-02/03 | Validación común y scripts reproducibles; T01 |
| F2-01 | Migraciones D1 y repositorios de usuarios/proyectos/settings; pruebas upgrade | F1-04 | Constraints, índices, local DB desde cero |
| F2-02 | Verificar Better Auth y sesión, bootstrap propietario, aislamiento | F2-01 | T02; sin registro público accidental |
| F2-03 | CRUD proyectos y wizard persistido | F2-02 | FR01–04; T03; revisiones y estados |
| F2-04 | Catálogo/versiones/research/script/scene/shot/asset; repositorios | F2-03 | Inmutabilidad, FK, relaciones scoped y fixtures |
| F3-01 | Modelo jobs, attempts, dependencies, activities, checkpoints, scheduler pure | F2-04 | T04/T06; estados y DAG probados |
| F3-02 | Claim, lease, fencing, reintentos/backoff, pause/resume, reconciliation | F3-01 | T05/T07–09; pruebas con fake clock |
| F3-03 | Config proveedores, capabilities, quota, reservation ledger y fallback policy | F3-02 | T12–13; no gasto real |
| F3-04 | Generations UI y producción overview, polling/estados/checkpoints | F3-03 | T10–11/T16; datos de jobs reales en mock |
| F4-01 | Adaptadores mock, agentes research/script y validación output | F3-04 | JSON versionado con fuentes trazables, checkpoint |
| F4-02 | Director audiovisual: visual bible, shot plans, modalidades y duración | F4-01 | múltiples tomas, refs y plan válido, checkpoint dirección |
| F4-03 | Editor guion, investigación, dirección, escenas y comparación versiones | F4-02 | FR05–07/10; activar versión no destructiva |
| F4-04 | Regeneración scopes y propagación de invalidación | F4-03 | T15/T21; preservar historial y derivados independientes |
| F5-01 | Import/asset service R2 y local metadata/checksums, biblioteca | F4-04 | T14; biblioteca privada y preview |
| F5-02 | Agente Node local: pairing, token, heartbeat, claim, disco, FFprobe | F5-01 | T05/T08/T14; Windows/local; offline visible |
| F5-03 | Manual assisted para ChatGPT/Flow/stock y carga de resultados | F5-02 | Prompt/refs, import validado, reanuda; T13 |
| F5-04 | Voz importada/mock y alineación de segmentos, timing real | F5-03 | sincronización de escena y cambio invalida dependientes |
| F5-05 | Investigar/implementar adaptadores autorizados disponibles de texto/voz/imagen/video | F5-04 | ADR y contract tests; no API asumida; opcional ensayo autorizado, declarar manual-only si no viable |
| F6-01 | Manifest, montagem declarativo, perfiles y preview | F5-04 | T17; determinismo y versionado |
| F6-02 | Composición Remotion + FFmpeg, render runner, audio/normalización | F6-01 | T18–19; fixture corto reproducible |
| F6-03 | QA editorial/técnica, blocker, corrección localizada y QA final | F6-02 | T20; límites de regeneración |
| F6-04 | Exportación final, paquete SEO y capítulos | F6-03 | T21; salida/render histórico y copiar metadata |
| F7-01 | End-to-end AUTO con fake providers y render local | F6-04 | T23, sin créditos |
| F7-02 | End-to-end supervisado/manual y fallos, UX/accesibilidad | F7-01 | T24, T16; corrección escena, reanudación |
| F7-03 | Backup/restore, hardening, límites y documentación operación | F7-02 | T22, seguridad y gate de release |
| F7-04 | Piloto corto real autorizado, presupuesto y métricas | F7-03 | evidencia de calidad/costo/tiempo, proveedor real validado o manual |
| F7-05 | Piloto video largo 10–15 min, ajuste de calidad y salida | F7-04 | T25; aceptación del propietario |
| F8-01 | Preparar entorno staging, smoke y revisar costos/límites vigentes | F7-05 | separación recursos, rollback y presupuesto; no deploy sin permiso |
| F8-02 | Despliegue privado controlado y runbook de producción | F8-01 | aprobación explícita; smoke, auth, agente, backup y recuperación |

## Gates por fase
F1 base reproducible, F2 seguridad y proyectos, F3 orquestación resiliente, F4 guion/dirección/editor, F5 recursos y agente local, F6 render/QA/YouTube, F7 piloto completo, F8 operación privada. En cada cierre, revisar con usuario (demo/evidencia), registrar deuda y aceptar antes de pasar fase. F5-05 puede quedar parcialmente manual sin bloquear F6; declarar limitación. Antes de F8, resolver validaciones pendientes de DECISIONS o documentar exclusión aprobada. No incorporar 4K, publishing automático, NLE o features extra antes de terminar MVP.
