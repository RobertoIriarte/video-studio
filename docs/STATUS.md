# Estado del proyecto — fuente viva para handoff

Última actualización: 2026-11-17. Alcance autorizado hasta F2-04 completado y verificado localmente. No iniciar F3 ni realizar deploy/push/gasto.

## Snapshot
- Fase 2 completada hasta F2-04. Siguiente tarea: F3-01, pendiente de autorización.
- Alcance autorizado vigente: F2-02 → F2-03 → F2-04, en orden y con validaciones por tarea. Sin nueva confirmación entre esas tareas; detenerse ante decisión material o cambio de arquitectura.
- Rama: `main`; remoto `origin`: `https://github.com/RobertoIriarte/video-studio.git`. Respaldo hasta F2-04 autorizado por el propietario, conservando el commit inicial del remoto. Este respaldo usa `[skip ci]` para no ejecutar CI alojada ni consumir minutos remotos.
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

Estados: TODO, IN_PROGRESS, REVIEW, DONE, BLOCKED. Añadir fila con comandos realmente ejecutados, resultados (pasó/falló/no ejecutado y motivo), archivos principales, commit si autorizado, deuda y próxima tarea. No borrar historial reciente; archivar antiguos hitos si crece. No duplicar toda especificación aquí.

## Evidencia anterior

[F1-01 a F1-03: comandos, resultados y limitaciones](history/phase-1-validation.md). Historial conservado íntegro; resumen de hitos en la tabla.

Evidencia F1-04/F2-01 conservada en [historial](history/f1-04-f2-01-validation.md).

## Evidencia de cierre

[F2-02 a F2-04: archivos, comandos, resultados y límites](history/phase-2-validation.md). ADR [auth](adr/0002-better-auth-local.md) y [catálogo](adr/0003-catalog-versions.md). Sin secretos/medios/DB candidatos a Git, sin staging/commit/push ni servicios de prueba abiertos. Base local de desarrollo: 64 migraciones, user/projects/assets 0; propietario real aún no creado. Ver README para `local:setup` y bootstrap interactivo.

## Próximo paso
Revisión del propietario. Con autorización, planificar F3-01 (jobs, attempts, dependencies, activities, checkpoints y scheduler puro). No iniciar F3 automáticamente. Continúa deuda de tipos SDK documentada; cloud/CPU, CI alojada/Linux y proveedores reales no verificados.
