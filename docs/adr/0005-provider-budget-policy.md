# 0005 — Capacidades y presupuesto sin integración pagada implícita

2026-11-17. F3-03 implementa interfaces/política y persistencia del stack acordado, sin SDK externo nuevo.

ProviderAdapter separa contrato genérico y contexto sin DB; capacidades/configuración/errores/usage viven en contracts. chooseProvider filtra capacidad, idioma, tamaño, duración, disponibilidad y preferencias; conserva prioridad de suscripción compatible. Pago exige autorización y política explícita, cotización o tope y moneda/presupuesto compatibles; no hay conversión automática ni aumento de presupuesto por un fallo. Errores externos se normalizan por código sin copiar mensaje, URL ni credenciales.

La configuración normal solo admite MANUAL_ASSIST/MANUAL_ONLY. MOCK_FIXTURE solo se crea desde fixtures servidor explícitas: no hay adaptador de contenido funcionando ni API de pago activable. Los nombres ChatGPT/Flow no representan integraciones verificadas; V02/V03 siguen pendientes de sus tareas. La vía manual conserva el job WAITING_MANUAL; importación binaria/validación final pertenecen a F5, aún no disponibles.

usage_records usa INSERT SELECT condicional y operaciones idempotentes. FK scope owner/proyecto/job/proveedor, una reserva activa por job y una key por owner. Presupuesto incluye RESERVED+SETTLED+UNKNOWN; cuota por ventana incluye reservas/liquidaciones/desconocidos y concurrencia ocupa RESERVED/UNKNOWN incluso de ventanas previas. Cantidades enteras seguras en microunidades, una moneda. Precio desconocido exige tope configurado o bloquea; cuotas no verificadas bloquean ejecución automática.

Reservas de planificación pueden existir antes del claim; BEGIN de efecto externo exige reserva vigente y proveedor habilitado dentro de la misma actualización del intento. Finalización/fallo/reconciliación actualizan el ledger en el batch cercado del job: fallo definitivamente rechazado libera; costo desconocido retiene tope; resultado verificado liquida dentro del cap; observación por encima del cap queda UNKNOWN para revisión. Una respuesta perdida no reserva/paga otra vez. No existe endpoint web que pueda declarar costo, liberar UNKNOWN o fingir resultado de proveedor.

Las pruebas simulan cotizaciones y unidades sobre D1 real efímero; ningún número es gasto real. El SQL de reserva de esta fase acepta exclusivamente configs MOCK; ampliar a proveedor real requerirá el ADR/validación/autorización de F5-05. Preparación de disponibilidad no invoca start/poll. El coordinador no depende del navegador y solo prepara/recupera lotes; no produce contenido.
