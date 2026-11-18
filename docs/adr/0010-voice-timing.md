# ADR 0010 — Voz importada y tiempos revisables

Estado: aceptada en F5-04, 2026-11-18. Mantiene producción multimedia local y coordinación breve en Workers.

Se usa la duración del audio inspeccionado (WAV por contenedor; comprimidos por FFprobe local), no la duración estimada del guion. Importar voz crea candidata y conserva narración y versiones anteriores. Las duraciones enteras de las tomas se redistribuyen proporcionalmente con suma exacta. Imágenes se conservan; videos insuficientes se desenlazan únicamente en la nueva candidata y se señalan para reemplazo, sin estirar ni borrar archivos. Otros audios se recortan dentro de sus límites.

El usuario puede aportar segmentos manuales con cobertura de la narración, orden, ausencia de solapamientos y límites dentro del archivo real. Si no los aporta, una función pura y acotada distribuye palabras sobre la duración total. Se etiqueta **ESTIMATED**: no hay reconocimiento del habla, detección de pausas ni forced alignment. La UI pide revisión auditiva y activación explícita; el propietario puede reemplazar la estimación por tiempos manuales. La selección de un motor local de reconocimiento no se presupone ni provoca descargas de modelos o uso de APIs.

Los segmentos son hijos inmutables de scene_version, con FK al audio del mismo proyecto. Migraciones 0129–0132 añaden tabla y triggers; el campo de input es opcional y los DTO antiguos se leen con array vacío. Los hashes de inputs antiguos no se reescriben. Los tiempos participan en el componente TIMING; activar propaga la invalidación a montaje/QA/render, conservando componentes independientes e historial.

Las escenas que ya contienen segmentos no encolan otro ALIGNMENT sin implementación. El agente sigue declarando alignment=false; su FFprobe proporciona metadatos reales. La estimación matemática de metadatos no ejecuta multimedia en la nube. Un motor acústico posterior tendrá que declarar capacidades reales y conservar esta vía manual.

MockVoiceAdapter produce exclusivamente un tono PCM WAV de hasta cinco segundos para fixtures, con simulated=true y speech=false. No se expone como proveedor de voz hablada ni se activa en configuración normal. Pruebas con ese tono verifican archivo/duración, persistencia e invalidación; no prueban calidad de narración.
