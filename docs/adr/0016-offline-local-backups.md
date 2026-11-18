# 0016 — Backups locales offline y restore aislado

Fecha: 2026-11-18. F7-03 autorizada dentro del stack acordado.

Se implementa un snapshot físico versionado de los subárboles D1/R2 locales y mediaRoot del agente. Requiere detener escritores y confirmar `--quiesced`; no se promete consistencia entre bases mientras escriben. Se vuelve a comprobar el inventario de origen y cada archivo tras copiar. El inventario Zod registra SHA-256, tamaño y fingerprint del esquema. BACKUP.json sólo se crea al terminar.

Restore verifica datos/rutas/esquema antes de crear un destino exclusivo nuevo, siempre fuera del repo y de los orígenes. Conserva IDs, versiones, recibos, hashes y archivos; produce layout Wrangler state/v3 y media. No reemplaza carpetas existentes ni inicia API/agentes/cron. Una restauración activa/destructiva y cloud quedan fuera del comando. RESTORE_COMPLETE.json distingue una copia completa de un parcial. No se borran parciales automáticamente.

Se rechazan symlinks/junctions, traversal, rutas alternativas Windows/ADS/nombres de dispositivos, colisiones de nombres, credenciales sueltas y límites de cantidad/profundidad/tamaño. Config/secretos del Worker y agente se administran por separado. D1 contiene datos privados y sesiones; backup fuera de Git, en almacenamiento privado/cifrado administrado por el propietario. Checksums no son firma ni cifrado. No hay servicio nuevo, dependencia externa ni migración destructiva.

T22 crea un proyecto completo con MP4 real y un recurso R2, detiene el Worker, copia/restaura, compara tablas de aplicación, inicia sesión con otro secreto de prueba, lee paquete/snapshot y R2, verifica originales y vuelve a renderizar con checksum idéntico. Pruebas adicionales rechazan corrupción, extras, esquema diferente, destinos existentes y enlaces fuera de alcance. [Runbook](../OPERATIONS.md).
