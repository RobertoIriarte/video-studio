# AGENTS.md — Video Studio

## Mandato
Construir un sistema privado de producción de videos largos para YouTube, orientado a calidad, recuperación ante fallos y costo marginal mínimo. El propietario aprueba el alcance y los cambios de arquitectura. No prometer monetización ni evadir condiciones de proveedores.

## Lectura obligatoria por tarea
1. Leer este archivo, `README.md` y `docs/STATUS.md`.
2. Identificar la siguiente tarea habilitada en `docs/ROADMAP.md`; leer exclusivamente las secciones relevantes de `docs/PRODUCT.md`, `docs/UX.md`, `docs/ARCHITECTURE.md`, `docs/DATA.md`, `docs/API.md`, `docs/PIPELINE.md`, `docs/PROVIDERS.md`, `docs/SECURITY.md` y `docs/TESTING.md`.
3. Inspeccionar el código y las pruebas existentes antes de editarlos. No volver a leer todos los archivos ni regenerar módulos completos por cada tarea.

## Reglas no negociables
- Monorepo pnpm, TypeScript estricto, React/Vite/Tailwind/shadcn, Hono en Cloudflare Workers, D1, R2, Better Auth, Zod, agente local Node.js, Remotion y FFmpeg. No cambiar stack sin ADR aprobado.
- El contrato compartido define DTO, enumeraciones y validación. La API valida nuevamente inputs y autorización; el frontend nunca accede directamente a D1 ni a credenciales.
- La nube coordina; el agente local produce/renderiza multimedia. Los trabajos son persistentes, idempotentes y reanudables. Sin dependencia de mantener el navegador abierto.
- Proveedores desacoplados. Primero suscripciones existentes cuando exista una vía compatible; siempre ofrecer importación manual asistida. API de pago solo con autorización y presupuesto.
- Ningún secreto, multimedia pesada, credencial de sesión, base real ni archivo .env con valores va a git. No automatizar interfaces privadas, desafiar captchas ni extraer cookies.
- Versiones y recursos aprobados son inmutables. Regenerar crea versión candidata; activar explícitamente. No borrar generaciones anteriores ni regenerar el proyecto entero por defecto.
- No añadir features fuera del roadmap, dependencias innecesarias ni abstraer prematuramente. Prohibido cambiar archivos ajenos a la tarea. Conservar cambios del usuario.
- No publicar, desplegar producción, consumir créditos, adquirir suscripciones o ejecutar migraciones destructivas sin autorización expresa. Pruebas con mocks y fixtures por defecto.

## Procedimiento de trabajo
Antes: `git status --short`, revisar rama, leer criterio de aceptación, indicar plan corto y archivos afectados. Si falta una decisión material, detenerse y preguntar. Si es un detalle reversible, documentar supuesto. Implementar una sola tarea vertical y acotada, incluyendo pruebas. Ejecutar lint, typecheck, test y build según alcance; nunca falsificar resultados. Revisar diff, actualizar STATUS con tarea, evidencia, deuda y siguiente paso. No marcar DONE si alguna prueba exigida falla; anotar BLOCKED. No hacer commit/push sin permiso. No alterar contratos sin migración y pruebas de compatibilidad.

## Ahorro de contexto
Usar rg, diffs y pruebas focalizadas; evitar volcar logs extensos. Usar fixtures pequeños y reproducibles. No cargar videos a contexto; inspeccionar metadatos y fotogramas relevantes. Resumen final: resultado, archivos, pruebas reales, bloqueos, siguiente tarea. Mantener STATUS breve; registrar decisiones duraderas en ADR, no en conversaciones solamente.

## Definition of Done
Requisitos y criterios satisfechos, validaciones y autorización correctas, fallos recuperables, pruebas relevantes verdes, tipos/lint/build correspondientes verdes, documentación actualizada, sin secretos ni costos inesperados, diff revisado. Los stubs deben señalarse claramente; no presentar un proveedor simulado como integrado.
