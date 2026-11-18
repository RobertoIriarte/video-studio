# 0006 — Publicación e invalidación de contenido

Fecha: 2026-11-17. Implementación de F4-01 a F4-04 autorizadas. Mantiene stack y límites acordados.

Research/script/director tienen JSON v1 y metadata de prompt/modelo/idioma/simulación; Zod valida contenido y relaciones. Catálogo genérico previo sigue legible. Mocks deterministas sin red, cobro ni referencias inventadas; proveedor normal permanece MANUAL_ONLY. Un resultado simulado se identifica en datos e interfaz. No se usan credenciales ni servicios externos.

El batch de publicación verifica lease vigente, inputs y parent, inserta candidata/hijos y termina intento/ledger/checkpoint. Candidato y fencing no se separan en commits distintos. El fanout ocurre fuera del manejo de errores del intento ya publicado, con recibos y registros de expansión persistentes; un corte lo retoma el coordinador. Tres escenas nuevas por invocación de fanout y un plan de followup por tick.

AUTO inicial activa solamente contenido nuevo validado; cualquier regeneración o reemplazo con base activa requiere revisión explícita. DIRECTION usa un checkpoint por versión de escena, según FK existente. No se generan medios antes de revisión. El plan usa duración orientativa hasta voz real; >128 s por escena requiere dividir, nunca estirar clips sin criterio.

Guardar edición crea candidata con CAS de proyecto y parent/revisión de escena. Activar versión exacta conserva payloads e historia y audita el cambio. Comparación por NARRATION/VISUAL/VOICE/TIMING/MUSIC/AMBIENCE/EDIT determina invalidez; VOICE afecta TIMING. Narración editada elimina de la candidata enlaces de voz/visual incompatibles, conservándolos en la versión anterior. Música/ambiente independientes sobreviven a cambios visuales. El orden aleatorio de IDs de enlaces no implica cambio de contenido.

Los jobs compatibles que referencian una escena SUPERSEDED mantienen una prueba scoped en job_version_compatibility hacia la activa actual. Sin esa prueba, el hash antiguo no habilita ejecución. Cambios posteriores actualizan la prueba solo para componentes compatibles. Se recorren dependencias declaradas para invalidar descendientes. Una activación de guion es global: invalida dirección/derivados de ese guion y quita los punteros activos incompatibles, sin borrar escenas, versiones ni assets.

Invalidación revoca leases; intentos externos posibles quedan UNKNOWN y reservas retenidas. Rechazo externo verificado con inputs ya reemplazados termina STALE y libera reserva; no programa retry. Resultado obsoleto no se publica. Followups persistentes registran solo el trabajo necesario; ejecutores aún ausentes quedan esperando manual/recurso. No se crean renders ni manifests ficticios: T21 comprueba conservación del snapshot sintético de job; reproducibilidad binaria se valida con F6.
