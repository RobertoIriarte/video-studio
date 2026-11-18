# 0015 — Exportación y paquete YouTube por render

Fecha: 2026-11-18. F6-04 autorizada; arquitectura y proveedores conservados.

## Decisión

Cada paquete revisado es una versión inmutable vinculada a renderId, manifestId/hash y checksum del MP4. Se puede editar metadata de un render histórico después de cambiar versiones activas. Los capítulos toman orden y tiempos de los frames del manifest de ese render; el título inicial y nombres se obtienen de su guion versionado. El servidor vuelve a validar estos tiempos, propietario, render SUCCEEDED y último QA FINAL aprobado. Guardar usa revisión del proyecto y recibo idempotente; cambiar metadata conserva versiones anteriores.

La propuesta inicial es determinista y editable, sin IA ni proveedor SEO integrado: título del guion, descripción/tags vacíos, nombres de capítulos del guion, sugerencias genéricas de miniatura y revisión de divulgación. El propietario revisa y confirma antes de guardar. No se promete posicionamiento, monetización ni aceptación automática de capítulos por YouTube. El límite local de descripción completa incluye capítulos; los timestamps de texto se truncan a segundos y los exactos se conservan en JSON.

COMPLETED exige un paquete revisado y render del montaje activo vigente; los errores, pausas y trabajos de render tienen prioridad. Un paquete histórico sigue exportable sin declarar completado un proyecto cuyo montaje cambió.

## Exportación local

El navegador permite copiar título/descripcion/tags/capítulos y descargar JSON de la versión guardada. El CLI autenticado obtiene el paquete por ID y verifica su pertenencia. El MP4 permanece en el equipo productor; no se abre un puerto del agente ni se sube a R2. `export --project UUID --package UUID --output RUTA_ABSOLUTA_NUEVA` copia video.mp4, manifest.json, youtube.json y description.txt a una carpeta nueva y conserva los originales. El receipt local del render y el checksum deben coincidir con el render elegido.

Se valida carpeta padre canónica, se rechazan symlinks y se crea el destino de forma exclusiva. COMPLETE.json se escribe al final con checksums de todos los archivos. Repetir con el mismo destino completo verifica identidad y checksums; no sobrescribe archivos modificados. Si falla a mitad, la carpeta queda incompleta y sin marca de finalización: usar una carpeta nueva después de resolver espacio/archivo faltante; no hay borrado automático. No se presenta como exportado un parcial.

## Compatibilidad

Migraciones 0145–0147 agregan youtube_packages y triggers de inmutabilidad/historial sin modificar registros previos. Nuevos DTO y endpoints; contratos existentes intactos. El paquete incluye snapshot y perfil/checksum del render, sin rutas locales ni credenciales. No hay publicación automática en YouTube, generación obligatoria de miniatura ni integración pagada. F7 permanece fuera de alcance.
