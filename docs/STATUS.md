# Estado del proyecto — fuente viva para handoff

Última actualización: 2026-11-18. Propietario autoriza F7-02 y F7-03; F7-04 queda fuera del alcance. F5-01 a F5-05 completas; integraciones externas MANUAL_ONLY. Sin deploy ni gasto. Respaldo Git del avance existente hasta F7-03 autorizado ahora por el propietario.

## Snapshot
- Fases 5 y 6 completas; F7-01 completa. F7-02 y F7-03 completas. Siguiente: F7-04, pendiente de autorización y presupuesto.
- Alcance autorizado vigente: F7-02 y F7-03; detenerse antes de F7-04 o ante decisión material de arquitectura. Sin autorización de gasto ni despliegue.
- Rama: `main`; remoto `origin`: `https://github.com/RobertoIriarte/video-studio.git`. Respaldo previo F2-04: `ef36f92`, conservando el commit inicial del remoto. El propietario autoriza commit/push del avance existente F3-F7-03 en esta entrega, con `[skip ci]` para no ejecutar CI alojada ni consumir minutos remotos. La autorizaci?n no se extiende a futuros avances.
- Validaciones pendientes: V02–V06 en DECISIONS. V01 comprobada localmente; producción/CPU cloud aún pendiente en V05.
- Herramientas locales instaladas con pnpm; plantillas sin secretos ni recursos cloud.

## Registro de ejecución (actualizar por cada tarea)
| Fecha | ID | Estado | Cambios / evidencia | Bloqueos / siguiente |
|---|---|---|---|---|
| 2026-11-17 | F0-07 | REVIEW | Documentación v1.0; sin desarrollo ni pruebas de código | Aprobar y planificar F1-01 |
| 2026-11-17 | F1-01 | DONE | Plan aprobado; Git local, ocho workspaces, TS strict, scripts, ignore/env, README. Instalación normal/congelada, lint, typecheck, test (2/2) y build: PASÓ | Propietario acepta y autoriza F1-02; sin commit |
| 2026-11-17 | F1-02 | DONE | Health/version, errores seguros, contratos Zod mínimos, Wrangler local, pruebas workerd. Instalación congelada, lint, typecheck, test (15/15) y build: PASÓ; smoke HTTP y cierre de servidor: PASÓ | Propietario acepta y autoriza F1-03; deuda del SDK documentada |
| 2026-11-17 | F1-03 | DONE | Shell oscuro, rutas UX, fixtures/24 escenas, estados y navegación accesible. Instalación congelada, lint, typecheck, test (15/15), build y E2E Chromium (24/24): PASÓ | Propietario acepta y autoriza F1-04; vistas de negocio pendientes |
| 2026-11-17 | F1-04 | DONE | Contratos Zod base/T01, suma pura de ms, fixtures deterministas y CI Ubuntu/Windows. Instalación congelada, lint, typecheck, build, test 68/68 y E2E 24/24: PASÓ localmente; actionlint: PASÓ | Propietario acepta cierre F1 y autoriza F2-01; CI alojada/Linux no ejecutada |
| 2026-11-17 | F2-01 | DONE | Cinco migraciones D1, repositorios internos y 33 pruebas nuevas. Instalación congelada, lint, typecheck, build, test 101/101 y E2E 24/24: PASÓ; migración local inicial/reaplicación: PASÓ | Aceptada por el propietario; evidencia de auth posterior en F2-02 |
| 2026-11-17 | F2-02 | DONE | Better Auth real/D1, bootstrap privado recuperable y sesión aislada. Lint/typecheck/build verdes; test 109/109 y E2E 24/24. Migraciones locales 0006–0015 aplicadas sin borrar datos. ADR 0002 | Sin propietario real creado; V01 local validada, límites cloud pendientes V05. Sigue F2-03 autorizada |
| 2026-11-17 | F2-03 | DONE | CRUD autenticado, wizard de 5 pasos, CAS y POST idempotentes, archivo lógico y demo separada. Lint/typecheck/build verdes; test 117/117 más 1 test CLI externo; 24 E2E demo y 1 flujo privado real verdes. Migraciones 0016–0018 locales aplicadas | Inicio de producción pendiente F3; editar/archivar solo DRAFT. Sigue F2-04 autorizada |
| 2026-11-17 | F2-04 | DONE | Ocho tablas de catálogo, FK scoped, payloads/hijos inmutables, candidatos y activación CAS, fixtures. Suite 127/127; catálogo 9/9 tras ajuste UTC; E2E 25/25, lint/types/build e instalación congelada verdes. 64 migraciones locales, reaplicación sin pendientes | Sin bloqueos locales. Recursos solo metadatos MISSING; invalidación/UI/importación en F4/F5. Detenido antes de F3-01 |
| 2026-11-17 | F3-01 | DONE | Contratos jobs, DAG/transiciones/scheduler puro, tablas y repositorios D1 scoped, recibos y actividad atómicos. Lint/typecheck/build y test 147/147 verdes (20 nuevas); diff revisado | Sin runner/proveedor aún. Sigue F3-02 autorizada; E2E se repetirá con UI F3-04 |
| 2026-11-17 | F3-02 | DONE | Lease/fencing, heartbeat, intentos, backoff/Retry-After, recuperación UNKNOWN, pausa/resume y checkpoint por versión. Coordinador acotado sin navegador. Lint/typecheck/build y test 157/157 verdes (10 nuevas), reloj/random inyectados | Sin executor de contenido ni cron cloud activado. Sigue F3-03 autorizada |
| 2026-11-17 | F3-03 | DONE | Config/capacidades, política desacoplada, cuotas y ledger RESERVED/SETTLED/RELEASED/UNKNOWN atómico; inicio externo exige reserva. Lint/typecheck/test 168/168 y build verdes (11 nuevas) | Solo vía manual en configuración normal; mocks explícitos en fixtures. Sin gasto ni adaptador real. Sigue F3-04 autorizada |
| 2026-11-17 | F3-04 | DONE | API/UI de Generaciones, Proveedores y producción, comandos idempotentes, revisión exacta, polling/estados. Suite 176/176, focalizadas finales 23/23, E2E 26/26, lint/types/build e instalación congelada verdes; 109 migraciones locales | Sin bloqueos locales. Sin ejecutores/importador; espera manual/recurso explícita. F4-01 no iniciada |
| 2026-11-17 | F4-01 | DONE | Agentes mock research/script, JSON v1, reparación acotada y publicación fenced atómica. Lint/types/build verdes; suite 180/180 (4 nuevas) | Sin proveedores reales ni gasto. Sigue F4-02 autorizada |
| 2026-11-17 | F4-02 | DONE | Director mock, presets y modalidades, biblia visual y varias tomas por escena. Fanout persistente reanudable y checkpoints por escena. Lint/types/build verdes; 8/8 pruebas focalizadas (4 nuevas) | Sin producción multimedia. Sigue F4-03 autorizada |
| 2026-11-17 | F4-03 | DONE | API/editor de investigación, guion, dirección/escenas, comparación e historial paginado. Lint/types/build verdes, 4/4 pruebas D1/API nuevas verdes y 27/27 E2E con 26 escenas, axe y móvil | Candidatas/activación explícita. Sigue F4-04 autorizada |
| 2026-11-17 | F4-04 | DONE | Scopes, impacto, candidatas revisables, invalidación/compatibilidad por componente, UNKNOWN y followups persistentes. Suite 193/193, finales 9/9 y 4/4, E2E 27/27 más focal 1/1; lint/types/build verdes; migraciones 117/reaplicación verdes | Sin bloqueos locales. T15/T21 sobre datos/snapshot sintéticos; multimedia real F5/F6. F5-01 no iniciada |
| 2026-11-17 | F5-01 | DONE | Importaciones privadas R2 local, checksum/firma, biblioteca y preview autorizada. Lint/types/build y suite 196/196 verdes; 27 E2E anteriores más focal biblioteca 1/1 verdes tras corregir móvil y aislar sesiones/owners de fixtures | Comprimidos esperan FFprobe en F5-02; sin cloud/costos. Sigue F5-02 autorizada |

| 2026-11-18 | F5-02 | DONE | Pairing/token hash, heartbeat, claims persistentes, revocación y cache seguro; FFprobe 9.0.2 real en Windows. Lint/types/build, suite 202/202 y E2E 29/29 verdes; ADR 0008 | Sin render ni cuenta real vinculada. Sigue F5-03 autorizada |

| 2026-11-18 | F5-03 | DONE | Prompt/referencias descargables, import JSON/stock/música, publicación atómica y CLI LOCAL_ONLY recuperable. Lint/types/build, manual 3/3, agente nativo 3/3 y E2E manual 1/1 verdes; ADR 0009 | Sin automatizar cuentas ni gasto. Sigue F5-04 autorizada |

| 2026-11-18 | F5-04 | DONE | Audio importado/mock explícito, voice_segments inmutables, tiempos manuales/estimados y retiming exacto; invalidación al activar. Lint/types/build, focalizadas 24/24 y E2E voz 1/1 verdes; ADR 0010 | Sin reconocimiento acústico ni proveedor de voz hablada. Sigue F5-05 autorizada |

| 2026-11-18 | F5-05 | DONE | Revisión oficial/catálogo MANUAL_ONLY y contract tests; ADR 0011. Instalación congelada offline, lint/types/build, suite 210/210 y E2E 31/31 verdes; tras revisión final, focales 11/11 + 3/3 y E2E 4/4 verdes. Migraciones locales 132/reaplicación sin pendientes | Sin API externa activa ni ensayo de pago; tiempos estimados revisables. F6-01 requiere aprobación |

| 2026-11-18 | F6-01 | DONE | Manifest v1, frames deterministas, candidatas/activación scoped, editor y preview Remotion. Types/lint/build, manifests 2/2 y E2E montaje 1/1 verdes; ADR 0012 | Sigue F6-02 autorizada. Sin MP4 local aún |

| 2026-11-18 | F6-02 | DONE | Runner local con lease/heartbeat, Remotion+FFmpeg loudnorm, publicación LOCAL_ONLY atómica y recuperación. Types/lint/build, focales API 10/10, render nativo 3/3 y E2E cola 1/1 verdes; ADR 0013 | Fixture real 10 s/300 frames, MP4 FHD y checksums iguales. Sigue F6-03 autorizada |

| 2026-11-18 | F6-03 | DONE | QA por snapshot, aprobación explícita, blockers y dos correcciones por manifest; ADR 0014. Instalación congelada, lint/types/build, suite 222/222 y E2E 34/34 verdes; cierre focal 6/6 + E2E 2/2. Nativo real 4/4; migraciones 144, reaplicación sin pendientes | Sin bloqueos locales. Revisión editorial humana, proveedores manual-only. F6-04 requiere autorización |

| 2026-11-18 | F6-04 | DONE | Paquete/SEO determinista editable por render, capítulos, copiar/JSON y export local verificado; ADR 0015. Regresión 219 casos + smoke 2/2 con invocación corregida; nativo 4/4, E2E 35/35, focal final 2/2 + nativo 1/1 + E2E 1/1; lint/types/build/doctor verdes. [Detalle](history/phase-6-validation.md) | 147 migraciones, sin pendientes ni datos reales añadidos. Sin bloqueos locales; F7-01 pendiente de autorización |

| 2026-11-18 | F7-01 | DONE | T23 desde tema nuevo/AUTO con mocks hasta MP4 real 5 s/150 frames, QA, paquete y exportación. Prueba inicial 1/1; cierre 11/11 en cinco archivos, sin skips, lint/types/build verdes. [Evidencia](history/phase-7-validation.md) | Sin bloqueos locales. Fixture realiza importaciones/revisiones explícitas; no autonomía de proveedores manual-only. F7-02 requiere autorización |

| 2026-11-18 | F7-02 | DONE | Guion propio/fuentes supervisados, pausa/reanudación, imports rechazados y corrección localizada hasta MP4/export: 2/2 nativos; AUTO refactorizado 1/1. Foco de diálogo corregido; E2E supervisado 1/1 y orquestación 1/1; types/lint/build web verdes | Sin bloqueos locales. Sigue F7-03 autorizada |

| 2026-11-18 | F7-03 | DONE | Backup/verify/restore offline D1/R2/media, destinos nuevos, inventario y hardening; [runbook](OPERATIONS.md), ADR 0016. T22 real reproducible + focales backup 4/4; regresión no nativa 224/224 y E2E 36/36; lint/types/build y CLI compilado 3 operaciones verdes | Sin bloqueos locales. No restauración sobre datos reales ni cloud. F7-04 requiere autorización/presupuesto |

Estados: TODO, IN_PROGRESS, REVIEW, DONE, BLOCKED. Añadir fila con comandos realmente ejecutados, resultados (pasó/falló/no ejecutado y motivo), archivos principales, commit si autorizado, deuda y próxima tarea. No borrar historial reciente; archivar antiguos hitos si crece. No duplicar toda especificación aquí.

## Evidencia anterior

[F1-01 a F1-03: comandos, resultados y limitaciones](history/phase-1-validation.md). Historial conservado íntegro; resumen de hitos en la tabla.

Evidencia F1-04/F2-01 conservada en [historial](history/f1-04-f2-01-validation.md).

## Evidencia anterior de F2

[F2-02 a F2-04: archivos, comandos, resultados y límites](history/phase-2-validation.md). ADR [auth](adr/0002-better-auth-local.md) y [catálogo](adr/0003-catalog-versions.md). Respaldo F2 en remoto: `ef36f92`; F3 continúa local sin nuevo commit/push. Ver README para `local:setup` y bootstrap interactivo del propietario real.

## Próximo paso

[Evidencia F3](history/phase-3-validation.md) y [F4: archivos, comandos y límites](history/phase-4-validation.md). Base local: 147 migraciones aditivas aplicadas y reaplicación sin pendientes; user/projects/jobs/usage_records 0. Sin cuenta real ni recursos/gastos remotos. Demo previa en 5173 conservada. Bundle web ~946 kB con advertencia no bloqueante; continúan deuda SDK y validaciones cloud/CPU/CI alojada/Linux. [ADR 0006](adr/0006-content-publication-invalidation.md).

F5-01 a F5-05 completadas. [Evidencia F5](history/phase-5-validation.md), [uso del agente e importación](../README.md) y ADR 0007–0011. Sin bloqueos locales; limitaciones: APIs externas manual-only, sin reconocimiento acústico ni verificador factual automático. R2 exclusivamente local/emulada; archivos de pruebas sintéticos. F6-01 a F6-04 completas: [evidencia y límites](history/phase-6-validation.md), montaje/QA/render, paquete YouTube versionado y exportación local disponibles. Propuesta SEO sin IA, editable y revisada por el propietario. F7-01 completa: [T23 y límites](history/phase-7-validation.md), prueba integral simulada sin créditos. F7-02/F7-03 completas: supervisado, fallos/UX, backup offline y restore aislado; [operación](OPERATIONS.md). Detenido antes de F7-04 (piloto real), pendiente de aprobación y presupuesto. Sin commit/push automático. No presentar mocks como proveedores integrados; APIs pagadas siguen sin autorización.
