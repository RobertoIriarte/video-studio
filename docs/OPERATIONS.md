# Operación local y recuperación

Alcance validado: Windows local, D1/R2 emulados y agente Node. Sin despliegue cloud, pilotos pagados ni publicación automática en YouTube. Usar Node/pnpm fijados y el checkout compatible. La base, multimedia y copias privadas nunca deben entrar a Git.

## Diagnóstico y límites

1. Desde el proyecto, revisar etapa, job/attempt y diagnóstico. Un proveedor MANUAL_ONLY requiere importar y revisar el resultado incluso en AUTO. No repetir una operación externa UNKNOWN hasta reconciliar su aceptación/costo.
2. `pnpm.cmd dev:agent doctor` comprueba FFprobe, espacio y composición/Chromium. Para un render LOCAL_ONLY usar el equipo que contiene su caché; `locate` verifica su recibo y checksum. No mover ni renombrar archivos internos para arreglar referencias.
3. Pausar con la UI antes de intervenir. Esperar PAUSED; PAUSING significa que todavía hay trabajo activo. Para espacio insuficiente, liberar espacio fuera de los archivos requeridos por versiones aprobadas y reintentar desde el job; para archivo ausente, recuperar la copia con el checksum esperado. No borrar historial ni sustituir el contenido de versiones aprobadas.

| Límite local implementado | Valor / comportamiento |
|---|---|
| Body JSON API | 6 MiB + 16 KiB; rechazo antes del handler |
| Subida web | 5 MiB; para archivos mayores usar importación local |
| Archivo procesado por agente | 2 GiB; checksum y firma/FFprobe, sin shell |
| Duración multimedia / manifest | Hasta 6 h / 648000 frames a 30 fps |
| Visual inspeccionado | Máximo 8192 por dimensión y 16777216 píxeles |
| Snapshot de montaje | 100 escenas, 16 tomas por escena, 512 assets únicos, JSON hasta 4 MiB |
| Correcciones QA | Dos solicitudes por manifest, compartidas entre informes |
| Render | Dos workers de frames; reserva inicial de disco más espacio de salida; parcial no publicado |
| Exportación / restore | Destino nuevo exclusivo, sin sobrescritura ni borrado automático |
| Backup | 100000 archivos, 2 GiB por archivo, profundidad 32, inventario JSON hasta 16 MiB; reserva extra de 16 MiB |

Son límites del software local, no validación de cuotas/CPU cloud. Continúan pendientes V02–V06 en DECISIONS y las pruebas alojadas/Linux. Los fixtures verifican archivos y recuperación; no prueban calidad editorial ni inteligibilidad de voz hablada.

## Crear backup offline

Detener API local y todos los agentes que puedan escribir sobre ese estado/caché, después de pausar y resolver trabajo activo. La UI web sola no escribe archivos de D1, pero cerrar el navegador no detiene al agente. `--quiesced` confirma esta condición; el programa no puede demostrar que se detuvo un escritor externo. Rechaza symlinks/junctions y verifica nuevamente inventario/checksums de origen después de copiar. Esto detecta cambios, pero no sustituye detener los escritores para obtener consistencia entre D1, R2 y multimedia.

Estado habitual de Wrangler: `<REPO>\infra\.wrangler\state\v3`, con subdirectorios `d1` y `r2`. Usar el mediaRoot real configurado en el agente, no una carpeta que contenga documentos o credenciales ajenos. El destino debe ser una carpeta absoluta nueva **fuera del repositorio y de los orígenes**. Ejemplo, ajustando rutas:

Si el binding R2 todavía no se usó y su carpeta no existe, se conserva como vacío; no se inicializa ni escribe el origen por hacer backup. D1 y mediaRoot deben existir. Un recurso ya perdido antes del backup no se reconstruye con una copia: comprobar las referencias durante el ensayo de restore.

```powershell
pnpm.cmd dev:agent backup --state "D:\PROYECTOS\SISTEMA PRODUCCION VIDEO\video-studio\infra\.wrangler\state\v3" --root "C:\Users\TU_USUARIO\AppData\Local\VideoStudio\media" --output "D:\RESPALDOS\VideoStudio\copia-2026-11-18-01" --quiesced
pnpm.cmd dev:agent verify-backup --backup "D:\RESPALDOS\VideoStudio\copia-2026-11-18-01"
```

Incluye archivos físicos de D1/R2, caché de assets, versiones de render, recibos y parciales existentes. BACKUP.json se escribe al final con inventario, tamaños, SHA-256 y fingerprint de migraciones. Si falta esa marca, la copia es parcial y no se restaura. Ante un fallo, conservar el origen y repetir en otro destino nuevo tras resolverlo. No se borra la carpeta parcial automáticamente.

No incluye `.env`, worker.env ni agent.json/configuración del agente. El D1 sí contiene datos privados, hashes de acceso y sesiones: guardar copias en almacenamiento privado con ACL del propietario y cifrado del volumen/medio; no compartirlas ni subirlas a Git. Guardar por separado y de forma segura el checkout/versión de herramientas y la configuración/secretos necesarios, sin incorporarlos al inventario. Conservar al menos dos generaciones verificadas en medios distintos antes de aplicar una política manual de retención. El programa no borra copias ni rota claves automáticamente.

## Restaurar en entorno aislado

1. Usar copia propia verificada y el checkout con el mismo esquema; un fingerprint de migraciones diferente se rechaza. SHA-256 detecta corrupción, no autentica una copia de origen desconocido. No editar el fingerprint para eludir el rechazo; recuperar primero el checkout compatible y planificar cualquier upgrade aparte.
2. Restaurar a una carpeta absoluta nueva fuera del repo y de la copia:

```powershell
pnpm.cmd dev:agent restore --backup "D:\RESPALDOS\VideoStudio\copia-2026-11-18-01" --output "D:\RECUPERACION\VideoStudio-prueba-01"
```

3. Se crean `state\v3\d1`, `state\v3\r2` y `media`, con RESTORE_COMPLETE.json al terminar. No se reemplaza el estado activo. El formato `state\v3` coincide con la persistencia local de Wrangler fijada. Para una comprobación D1 aislada, usar **el mismo config y database_id**, apuntando explícitamente al nuevo directorio `state`, nunca al original:

```powershell
pnpm.cmd --filter @video-studio/api exec wrangler d1 execute DB --local --config ../../infra/wrangler.local.json --persist-to "D:\RECUPERACION\VideoStudio-prueba-01\state" --command "SELECT count(*) AS projects FROM projects"
```

4. Antes de dar servicio, comprobar inventario, proyectos, versiones activas e históricas, manifest/render/paquetes, ledger y referencias. Abrir recursos R2 privados con la API del entorno aislado y verificar SHA-256; comprobar originales locales y un render corto reproducible. Estas comprobaciones se automatizan en T22 con Worker/D1/R2 persistidos aislados; no equivalen a una restauración cloud de producción.
5. Para iniciar una API aislada con Wrangler, mantener config/bindings de origen, asignar puerto/origen web de prueba distintos y `--persist-to` explícito. No iniciar agentes/cron contra esa copia antes de revisar jobs/leases/UNKNOWN. Las credenciales de prueba deben quedar fuera del repo. Volver a iniciar sesión; invalidar sesiones y revocar agentes anteriores desde el entorno recuperado cuando se promueva una recuperación, y vincular equipos explícitamente. Las credenciales/config del agente no se restauran desde este backup. No reenviar jobs inciertos a proveedores ni autorizar gasto por restaurar.
6. La promoción sobre un entorno activo y cualquier restauración destructiva requieren autorización expresa y un procedimiento separado con rollback. Este comando sólo entrega una copia aislada; no sustituye carpetas, activa servicios ni despliega.

## Gate antes de piloto o release

Revisar STATUS/evidencia y pendientes de DECISIONS. T23 y T24 usan mocks/tonos, T22 copias locales; un piloto real exige autorización adicional, derechos, revisión editorial y presupuesto explícito. F7-04/F7-05 y F8 continúan pendientes. Ante incidente: pausar, identificar job/attempt y operación externa, conservar logs sanitizados/recibos, recuperar o importar la candidata correcta, verificar QA/archivo y después reanudar. Registrar evidencia sin tokens ni prompts completos.
