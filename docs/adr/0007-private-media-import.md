# 0007 — Importación privada y verificación

2026-11-17, implementación F5-01 autorizada. Mantiene D1/R2 y separación nube/agente.

Subida web acotada a 5 MiB, con intent idempotente, licencia/procedencia explícitas, checksum SHA-256 y clave por propietario/proyecto/asset/hash. R2 solo se configura local/emulado (`remote:false`); no se crean recursos cloud. Binario y publicación D1 son dos fases recuperables: un corte puede dejar objeto privado pendiente, nunca un asset falsamente disponible. Finalize y su recibo se publican en batch y reproducen los datos realmente insertados incluso en carreras.

PNG/JPEG/WebP tienen validación acotada de firma/contenedor/dimensiones; PNG verifica CRC. WAV PCM/float comprueba tamaños y calcula duración desde los frames, sin usar metadata del navegador. No sustituye QA/decodificación completa. MP3/Ogg/MP4 esperan FFprobe local y quedan sin publicar hasta entonces. La validación rechaza URLs/paths como fuente de subida, MIME no soportado y checksums/tamaños incompatibles. No se automatiza descarga de referencias.

Los binarios no se guardan en D1/Git ni se borran al reintentar. Payloads de assets e identidad de import son inmutables, con cambios de disponibilidad controlados. Acceso remoto necesita sesión/owner y ticket HMAC de cinco minutos; no revela r2_key, usa no-store/nosniff/sandbox. Un ticket robado no autoriza otra sesión/owner. Biblioteca muestra origen/licencia/prompt/metadata y disponibilidad; acceso local-only requiere agente, no paths arbitrarios desde el browser.

No hay dependencia nueva. FFprobe/archivos locales se implementan en F5-02; importación asistida y voz en F5-03/04, adaptadores reales solo si existe vía autorizada y presupuesto en F5-05. Sin presumir pago habilitado ni codec/QA integrado antes de probarlo.
