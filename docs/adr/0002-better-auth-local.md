# 0002 — Better Auth nativo en D1 local

Fecha: 2026-11-17. Implementación del stack aprobado, sin ORM adicional.

Better Auth 1.7.25 usa directamente el binding D1 con `nodejs_compat` en Workers. Las migraciones 0006–0015 completan el modelo nativo (sesiones, cuentas, verificaciones y rate limit), bootstrap único y límites persistentes. `user` existente se conserva. El test de introspección del SDK comprueba que no falten tablas, campos ni índices de auth.

Solo se exponen login/logout y `/me`; registro público cerrado. Bootstrap exige secreto privado externo al repo, Origin exacto e idempotency key estable. Reserva el único propietario antes de crear cuenta; el mismo intento recupera una cuenta parcialmente creada. No devuelve sesión. Login usa cookie HttpOnly/SameSite=Lax (Secure en HTTPS), verifica Origin y conserva rate limit en D1. En local la cuota de login es compartida para evitar confiar en IP enviada por cliente. No hay recuperación de contraseña ni envío de correo todavía.

La frontera `runtime.mjs` reexporta el SDK real. Su declaración estrecha evita mezclar tipos Bun/Node del SDK con globals Cloudflare manteniendo strict y skipLibCheck:false. Es deuda de tipos, cubierta por pruebas reales en workerd; no reemplaza ni simula autenticación. Una actualización del SDK exige volver a ejecutar introspección y pruebas de sesión/bootstrap.

V01 verificada localmente mediante SDK instalado y workerd: login/logout, caducidad/manipulación de cookie, dos propietarios aislados, bootstrap idempotente y recuperación parcial. No se ha probado un despliegue cloud ni límites CPU de producción (V05 sigue pendiente).

Fuentes oficiales: [D1](https://www.better-auth.com/docs/adapters/other-relational-databases), [email/password](https://www.better-auth.com/docs/authentication/email-password), [cookies](https://www.better-auth.com/docs/concepts/cookies), [rate limit](https://www.better-auth.com/docs/concepts/rate-limit). El esquema y las opciones se contrastan además contra el SDK fijado en lockfile.
