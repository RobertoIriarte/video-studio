# 0014 — QA por snapshot y correcciones acotadas

Fecha: 2026-11-18. Implementación de F6-03 dentro de la arquitectura acordada.

## Decisión

El QA pertenece al manifest inmutable y su hash. Un análisis PRE_RENDER registra un informe nuevo, sin efectos de generación. Voz ausente, segmentos ausentes, flags de revisión, recursos ausentes o licencia sin confirmar son BLOCKER. Tiempos estimados y baja resolución son WARN que requieren revisión humana explícita. Fuentes inaccesibles o notas de riesgo se muestran para revisión editorial; no se presenta como comprobación factual automática ni como modelo integrado.

El informe pasa a APPROVED mediante CAS, comprobando propietario, revisión, manifest activo/vigente y último informe PRE_RENDER. Un blocker no se puede aprobar. READY_RENDER, claim y publicación requieren ese QA; una revisión nueva retira la autorización anterior. Cambiar contenido exige nuevo snapshot y QA. Se conserva el historial de informes.

Correcciones solicitadas por el propietario derivan el scope de un hallazgo de una escena, reutilizan regeneración localizada y crean candidatas. Máximo dos solicitudes en total por manifest, incluso entre informes PRE_RENDER/FINAL o después de repetir análisis; comprobado atómicamente con el incremento de revisión del proyecto. Repetir un idempotency-key no consume otra ronda. No se activa contenido automáticamente ni se habilitan proveedores de pago. Las vías manuales existentes siguen disponibles.

## QA técnica final

El agente decodifica el MP4 completo con FFmpeg, mide audio y comprueba perfil/duración/frames/checksum con FFprobe. Política inicial conservadora: negro total mayor de 200 ms o silencio continuo mayor de 2000 ms por debajo de -50 dB bloquean. `blackdetect` usa proporción por defecto y umbral de píxel 0.10. No mide inteligibilidad, semántica ni sincronía fonética: el propietario las revisa en el preview. Secuencias oscuras o silencios artísticos pueden requerir cambiar el montaje; no hay un bypass que declare válido un archivo sin prueba.

La salida aprobada incluye `analysisVersion:1` y métricas; solo entonces se publican asset LOCAL_ONLY, render, informe FINAL APPROVED y recibo del agente en la misma transacción. Fallo técnico crea FINAL BLOCKED y job FAILED, sin asset. No hay exportación ni SEO en esta tarea. Los campos técnicos nuevos son opcionales en lectura para conservar DTO históricos, pero obligatorios para publicaciones nuevas.

## Consecuencias

No se descarga multimedia al Worker para analizarla ni se requiere mantener el navegador abierto. FFmpeg/Chromium permanecen locales. Los fixtures usan imágenes y tonos sintéticos, no voz hablada ni proveedores reales. El análisis implica una pasada de decodificación adicional; no garantiza ausencia de todos los defectos audiovisuales.
