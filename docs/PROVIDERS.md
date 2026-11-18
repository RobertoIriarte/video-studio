# Proveedores, costos y modos de integración

## Frontera de integración
Interfaces separadas por capacidad, con request/response del dominio: TextProvider (structured generation), ImageProvider, VideoProvider, VoiceProvider, StockProvider. Implementar `capabilities()`, `validate(request)`, `estimate(request)`, `start(request,context)` → resultado inmediato o `operationId`, `poll(operationId)`, `cancel(operationId)` si soportado. Context contiene idempotency key, timeout/AbortSignal, owner/project, no acceso a DB. Normalizar errores `AUTH_REQUIRED`, `RATE_LIMIT`, `QUOTA_EXHAUSTED`, `INVALID_INPUT`, `UNSUPPORTED_CAPABILITY`, `PROVIDER_UNAVAILABLE`, `CONTENT_BLOCKED`, `UNKNOWN_OUTCOME`, `LOCAL_UNAVAILABLE`, `BUDGET_EXCEEDED`. Output: assets refs/hashes, provenance, model, usage, costKnown, providerJobId; no persistir credenciales en DTOs/logs.

## Matriz inicial (validación antes de declarar activo)
| Tipo | Preferencia | Método mínimo de MVP | Verificación pendiente |
|---|---|---|---|
| Texto/investigación/guion | Herramienta compatible elegida | Mock + manual/import JSON; API autorizada si presupuesto | modelos, búsqueda/fuentes, límites y costo |
| Imagen | ChatGPT suscripción existente | Prompt + referencias, generación por usuario e import | integración oficialmente disponible, formatos, permisos y cuotas |
| Video | Google Flow suscripción existente | Prompt/toma, refs/fotogramas, generación por usuario e import | capacidades reales y límites de cada plan; automatización autorizada |
| Voz | Proveedor a seleccionar | mock + audio importado o local compatible | licencias, idioma, alineación, precio/calidad |
| Stock | Biblioteca local/público autorizado | importar con procedencia/licencia | derechos comerciales, atribución |
| Gráficos | Programático | Remotion/SVG seguros | legibilidad y exactitud |

No implementar automatización de navegador o cuentas privadas como supuesto. Si existe integración oficial y está autorizada, evaluar y proponer ADR. Si no existe, conservar flujo manual asistido funcional: job WAITING_MANUAL, UI muestra prompt, referencias descargables, tipo/dimensión/duración esperados, pasos de generación, importación, validación, licencia, confirmación y reanudación. Esto mantiene las suscripciones prioritarias sin prometer un pipeline hands-free imposible. El modo AUTO puede necesitar intervención en este caso y lo debe advertir antes de iniciar. APIs pagas opcionales solo explícitamente activadas.

## Política de proveedor y cuotas
Filtrar enabled, capacidad real (text-image, image-video, text-video, first/last-frame, aspect ratios, duración, tamaño, idioma), disponibilidad, licencia, límites, presupuesto, modalidad. Ordenar prioridad configurada; evitar fallback no compatible. Si precio no conocido, reservar según tope aprobado o bloquear. `allowPaidFallback=false` por defecto; nunca cambiar a pago ni incrementar presupuesto por un fallo. Mostrar costo relativo estimado en UI no como tarifa exacta; registrar fecha y origen al cotizar. Suscripción no significa costo marginal cero ni uso ilimitado: registrar modalidad SUBSCRIPTION y consumo en créditos/unidades cuando conocido; API registra moneda/micros y unidades. Mantener ledger de reserva/settlement/release/unknown con clave idempotente. Concurrencia por proveedor y propietario, ventanas/cuotas verificadas antes de ejecutar. No sumar monedas sin política de conversión y autorización; default presupuesto en una moneda.

## Alta de adaptador concreto
1. Leer docs oficiales, confirmar autorización, capacidades, costo, autenticación, derechos, rate limit y async/idempotencia. Guardar ADR con fecha/fuente. 2. Implementar adapter y pruebas de contrato usando mocks HTTP y fixtures, sanitización de errores. 3. Registrar capability flags/probe; no marcar disponible si credenciales o cuota faltan. 4. Ensayo real pequeño solo con aprobación de créditos. 5. Verificar import, metadata, ledger y fallback. Si falla integración, estado NOT_CONFIGURED o MANUAL_ONLY; nunca éxito simulado en producción.

## Resultado de F5-05 (2026-11-18)

La revisión vigente queda en [ADR 0011](adr/0011-provider-integration-review.md). Las vías de texto/imagen/video/voz/stock son MANUAL_ONLY; Proveedores muestra formatos, razones y fuentes públicas. No hay credenciales ni presupuesto API autorizados, y no se asumen beneficios de suscripción activos. F5-03 conecta prompt/referencias e importación recuperable; F5-04 conecta audio y tiempos revisables. MockVoiceAdapter solo produce un tono de fixture con speech=false. La existencia de API oficial no equivale a integración probada en este proyecto.
