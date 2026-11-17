# F2-01 — base D1 local y preparación de identidad

Fecha: 2026-11-17. Registro técnico dentro de la arquitectura aprobada; V01 queda parcialmente investigada, no resuelta. Sin cambio de stack ni autorización de producción.

## Alcance y evidencia

Migraciones SQL numeradas forward-only en `infra/migrations`, ejecutadas por Wrangler exclusivamente con `--local`. Binding `DB` con identificador nulo de desarrollo, `remote:false` y sin recurso cloud creado. Repositorios usan D1 nativo y parámetros enlazados, sin ORM nuevo. Proyecto y settings se insertan juntos mediante `D1Database.batch`, con rollback de la unidad completa si falla una sentencia.

La tabla `user` conserva nombres y campos del modelo core documentado de Better Auth: identidad, nombre, email único, verificación, imagen y fechas. No implementa sesiones, cuentas, contraseñas, registro, bootstrap ni métodos de escritura de identidad. La unicidad de email usa NOCASE y los IDs se almacenan como UUID TEXT conforme al contrato del proyecto. Las fechas de esta tabla pertenecen al adaptador de auth: afinidad SQLite DATETIME sin imponer el formato textual de las tablas de negocio.

En tablas de negocio se guardan fechas UTC canónicas con milisegundos y revisión positiva. `mode` vive solo en `projects`; `project_settings` guarda la configuración restante y su revisión propia. Los JSON se comprueban estructuralmente en SQL y se validan con Zod al leer/escribir. `style_version=1` y `storage_policy_json={}` son valores iniciales, no una integración de presets ni almacenamiento. El FK de versión activa de guion se añadirá con el catálogo F2-04, cuando exista su tabla destino.

Se prueba D1 real local mediante Miniflare/workerd efímero: desde vacío, upgrade 0003→0005 con registros existentes, constraints/FK/índices, scopes por owner y rollback. Cada archivo del baseline tiene una sentencia DDL completa para que el harness de pruebas no requiera parser SQL. El ledger y la reaplicación de migraciones los gestiona Wrangler, no un migrador propio.

## V01 pendiente para F2-02

La documentación de Better Auth describe campos core, IDs UUID configurables y un dialecto comunitario Kysely para D1. Esta consulta documental **no demuestra compatibilidad ejecutable** de una versión/adaptador concreto. No se instala Better Auth ni ese dialecto en F2-01.

Antes de habilitar auth: fijar y verificar la versión/adaptador, generar o contrastar su esquema completo (incluidas session/account/verification), configurar IDs UUID, comprobar serialización de fechas/booleanos y compatibilidad con `user`, y añadir migraciones forward-only si fueran necesarias. Después ejecutar sesión/bootstrap privado y aislamiento T02 en Worker local. No reemplazar tablas ni considerar esta base una autenticación integrada.

Fuentes oficiales consultadas el 2026-11-17: [core schema e IDs de Better Auth](https://better-auth.com/docs/concepts/database), [dialectos relacionales](https://better-auth.com/docs/adapters/other-relational-databases), [migraciones D1](https://developers.cloudflare.com/d1/reference/migrations/), [batch D1](https://developers.cloudflare.com/d1/worker-api/d1-database/) y [FK en D1](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).
