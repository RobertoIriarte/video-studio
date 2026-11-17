# Registro de decisiones (ADR resumidos)

## Base acordada, Fase 0 pasos 1–6
| ID | Decisión | Motivación |
|---|---|---|
| D01 | Tema, guion propio o fuentes; automático, supervisado e intervención manual | Flexibilidad sin duplicar pipelines |
| D02 | Documental cinematográfico, realista premium, terror/misterio; modalidades imágenes dinámicas, híbrida, cinematográfica y explicativa | Variar calidad/costo |
| D03 | Escenas con varias tomas, generación selectiva, versiones conservadas | Control audiovisual y reutilización |
| D04 | React/Vite/TS/Tailwind/shadcn; Hono/Workers; D1/R2; Better Auth; Zod/pnpm | Frontend y API económicos, contratos comunes |
| D05 | Agente Node.js local, Remotion y FFmpeg; archivos locales con respaldo | No alojar cómputo pesado permanentemente |
| D06 | Agentes de investigación, guion, dirección audiovisual, QA, SEO | Resultados estructurados especializados |
| D07 | Adaptadores desacoplados; prioridad ChatGPT y Google Flow contratados cuando viable; API opcional y manual asistido | Evitar dependencia y gasto inesperado |
| D08 | Orquestación persistente, paralelismo controlado, reintentos y pausa | Recuperación sin navegador |
| D09 | UI escritorio oscura, editor por escenas, no NLE completo | Control suficiente con complejidad acotada |
| D10 | Exportación MP4 Full HD y paquete YouTube | Entregable concreto; publicación manual |

## Defaults propuestos de implementación
- Identificadores UUID, timestamps UTC ISO 8601, duraciones enteras en ms, dinero entero en micro-unidades de moneda y moneda ISO. Sin cálculo flotante contable.
- Estado vital de trabajo y estado de etapa separados. D1 como cola persistente y fuente de verdad; tick programado/acotado y polling; sin servicio nuevo hasta medir necesidad.
- Agente local se conecta hacia afuera por HTTPS, reclama trabajos con lease y reporta heartbeat; no abrir puertos entrantes.
- Desarrollo local con mocks, staging aislado y producción autorizada. No credenciales reales en fixtures.

## Validaciones pendientes (no bloquear desarrollo con mocks)
V01: compatibilidad actual Better Auth + D1/Workers y migraciones; V02: mecanismos autorizados de ChatGPT/Flow, cuotas y límites; V03: elección de proveedor de voz/LLM y derechos; V04: versiones exactas Node/pnpm/FFmpeg/Remotion y soporte Windows; V05: límites Cloudflare de duración, almacenamiento y costo, y licencia Remotion aplicable; V06: estrategia definitiva de backup y retención ajustada al espacio real. Antes de implementar cada integración consultar documentación oficial vigente, registrar resultado, fecha y fuente en ADR. No declarar acceso API incluido en suscripción.

2026-11-17, F2-02: V01 verificada en D1/workerd local con Better Auth 1.7.25 real, introspección de esquema, bootstrap y sesiones. [ADR de autenticación](adr/0002-better-auth-local.md). Producción y límites CPU cloud siguen sin validar; V05 permanece pendiente.
