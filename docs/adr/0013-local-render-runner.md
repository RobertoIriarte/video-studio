# ADR 0013 — Render local recuperable

F6-02, 2026-11-18. Remotion/renderer/bundler 4.0.544 y FFmpeg/FFprobe locales, sin servicio de render cloud ni proveedor de pago.

El trabajo RENDER contiene un renderId y referencia a un manifest inmutable, no paths ni comandos. Crear job, snapshot de render y recibo es atómico. Un agente compatible reclama el trabajo con lease de 90 s y heartbeat cada 15 s durante producción. Solo procesa recursos del snapshot, comprueba hash/size/metadatos y usa el cache existente o una descarga autorizada por ese lease. Revocar o cambiar fuentes impide la publicación; el intento viejo no puede publicar con un lease nuevo.

El browser de render recibe archivos mediante un servidor efímero en loopback, puerto aleatorio y token aleatorio de 256 bits, con lista exacta de checksums. Solo GET/HEAD y rangos válidos; no es un puerto de control del agente ni acepta paths o URLs arbitrarias. Se cierra en finally. Chromium debe estar instalado; se reutiliza el de Playwright o VIDEO_STUDIO_CHROME_PATH. No se descarga un browser automáticamente durante producción. La composición se empaqueta desde código propio con resolver .js→.ts/.tsx para los contratos del monorepo.

Remotion produce frames PNG y H.264/yuv420p con color BT.709 explícito. El valor default de color del SDK produjo un formato fuera del perfil y la verificación lo rechazó; no se relajó la validación. FFmpeg aplica loudnorm en dos pasadas (-14 LUFS, -1 dBTP, LRA 11) copiando el video, y se vuelve a medir el archivo resultante. Se verifican codec, resolución, fps, frames, duración (tolerancia máxima de un frame: 34 ms), loudness y checksum. La cola no declara listo un archivo que no existe.

Cada intento usa un directorio UUID separado. Raw/normalized son parciales propios; final.mp4 se publica localmente por enlace exclusivo solo después de verificarlo, seguido de recibo de recuperación. Una respuesta perdida reutiliza el artefacto verificado, no lo sobrescribe. La publicación D1 de asset LOCAL_ONLY, ubicación, render y recibo del agente comparte transacción con el fencing del job. No se sube automáticamente un MP4 pesado. locate permite al operador local encontrar el archivo verificado; paths y tokens no llegan a DTOs web.

DISK_FULL, LOCAL_FILE_MISSING y RENDER_FAILED son errores locales explícitos, sin costo externo. Disco se comprueba antes de render; cancelación conserva parciales sin registrarlos como salida. Reintentos conservan historial y están limitados por maxAttempts.

D1 limita la profundidad de expresiones a 100. El gate de inputs se expresa mediante CASE (misma validación por tipo) y una vista de manifests vigentes; evita cadenas OR profundas al añadir la comprobación del snapshot. Migraciones 0137–0140 conservan renders e impiden modificar una salida publicada. Compatibilidad se verifica también con jobs/regeneración F3–F5.

Ensayos son renders de desarrollo con contenido sintético. Remotion 4 no requiere optar a telemetría de servidor mediante licencia; no se fija una clave ni se crea cuenta. Se respeta el uso permitido para el desarrollo privado; no se adquiere licencia ni se consume servicio remoto. [renderMedia](https://www.remotion.dev/docs/renderer/render-media), [color](https://www.remotion.dev/docs/options/color-space), [telemetría](https://www.remotion.dev/docs/telemetry), [FFmpeg filtros](https://ffmpeg.org/ffmpeg-filters.html).
