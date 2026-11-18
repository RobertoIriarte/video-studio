# ADR 0009 — Resultados manuales recuperables

Estado: aceptada en F5-03, 2026-11-18. No cambia el stack ni automatiza cuentas privadas.

El propietario abre un trabajo WAITING_MANUAL, copia prompt/referencias, utiliza su herramienta y devuelve JSON o importa archivos en Biblioteca. Se conservan fuentes, metadatos, procedencia y licencia. ChatGPT/Flow se abren únicamente por acción del usuario; no hay navegador automatizado, extracción de cookies ni suposición de APIs incluidas en suscripciones.

La API valida contratos y ownership de cada referencia; stock visual debe tener el tipo esperado y video suficiente para la toma. Música/ambiente requieren audio verificado y trims válidos. Guion, dirección y asignaciones generan candidatas, con revisión y activación explícita. Un cambio de narración conserva el historial y retira voz/visuales incompatibles de la nueva candidata.

Publicación manual no reclama un lease artificial: una transacción D1 comprueba estado/revisión/dependencias/inputs actuales, ausencia de incertidumbre, pausa y recursos; inserta versión/hijos, intento completado, checkpoint y recibo idempotente. Una respuesta perdida permite repetir exactamente la operación sin duplicar versiones. El coordinador retoma sucesores desde D1 sin navegador. No se registra costo cero de un proveedor externo cuyo consumo se desconoce.

La consola `dev:agent import --file <absoluto> --project <UUID> --mime <MIME> --source <procedencia> --rights` inspecciona con FFprobe, copia a cache y registra LOCAL_ONLY. Antes de llamar a la API guarda el cuerpo/nonce pendientes fuera del repo; repetir `import` recupera una respuesta perdida. No sube automáticamente el archivo ni transmite su path. Límite local 2 GiB/6 h, disco de reserva 100 MiB; límite web 5 MiB. Preview web de LOCAL_ONLY no disponible: Biblioteca lo explica. Una copia remota de archivos grandes requerirá la fase correspondiente, no se añade transferencia implícita.
