# ADR 0008 — Agente local y FFprobe

Estado: aceptada dentro de F5-02, 2026-11-18. Conserva la arquitectura aprobada.

El agente Node realiza conexiones salientes a la API por HTTPS (HTTP solo loopback). Vinculación de cinco minutos y un uso; tokens aleatorios de 256 bits, hash SHA-256 en servidor y archivo privado fuera del repositorio. La respuesta de vinculación se cifra con AES-GCM para recuperar una respuesta perdida dentro del TTL. Revocar invalida el bearer y vence sus leases; no elimina archivos ni historial.

Claims e intentos son persistentes, con recibo atómico, fencing y lease de 90 segundos. El agente conserva la operación pendiente antes de solicitar trabajo; el API limita un trabajo vigente por equipo. Polling de cinco segundos con backoff de red hasta treinta; heartbeat también cada cinco segundos durante esta versión. La UI considera offline tras 45 segundos. No hay puertos entrantes, comandos shell recibidos ni ejecución de render todavía.

FFprobe se ejecuta con argv, sin shell, límites de tiempo/salida, protocolos y demuxers permitidos. Los metadatos se obtienen del archivo real y SHA-256 del stream; paths locales no se envían al navegador. El cache rechaza escapes y symlinks/junctions y publica archivos mediante enlace exclusivo, conservando recursos previos. Importaciones rechazadas quedan visibles, sin volver a inspeccionarse indefinidamente.

Se usa Vite ya instalado para empaquetar el CLI Node; Zod se declara directamente en el workspace que lo utiliza. No se añade un bundler ni se cambia el stack.

Verificación Windows: FFprobe 9.0.2 portable instalado en `%LOCALAPPDATA%/VideoStudio/tools`, sin modificar PATH ni guardar binarios en Git. ZIP con SHA-256 `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`, contrastado antes de extraer. No se instala automáticamente en otros equipos; `--ffprobe` o `VIDEO_STUDIO_FFPROBE_PATH` permiten indicar una instalación propia. Las pruebas nativas se omiten explícitamente si falta el ejecutable; no equivalen a una validación Linux.

Fuentes oficiales consultadas: [FFmpeg, descargas](https://ffmpeg.org/download.html), [Gyan, build Windows enlazada por FFmpeg](https://www.gyan.dev/ffmpeg/builds/), [checksum publicado](https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip.sha256), [FFprobe](https://ffmpeg.org/ffprobe.html) y [formatos/demuxers](https://ffmpeg.org/ffmpeg-formats.html).

No se ejecutó emparejamiento de un propietario real, cloud, proveedores ni operaciones de pago. Los ensayos usan Better Auth/D1/R2 efímeros y archivos sintéticos.
