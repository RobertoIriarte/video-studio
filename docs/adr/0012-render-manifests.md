# ADR 0012 — Montaje y manifest reproducible

F6-01, 2026-11-18. Detalle de implementación dentro del stack aprobado; sin infraestructura remota nueva.

El manifest v1 fija guion/escenas aprobados, IDs y SHA-256 de recursos, orden, frames, ajustes de toma, tracks/ganancias/fades y overlays de texto. No contiene paths locales, código, HTML ni URLs de proveedor. Full HD 1920×1080, 30 fps, H.264/AAC/yuv420p. Duraciones se cuantizan por límites acumulados, no sumando redondeos independientes; una toma de cero frames se rechaza. La tolerancia de duración de un archivo es como máximo un frame. No se estiran videos.

Escenas requeridas son las del guion activo; escenas residuales de un guion anterior no impiden montar uno nuevo. Límites iniciales: 100 escenas, 16 tomas por escena, 512 recursos únicos, seis horas y JSON de 4 MiB. Los límites son explícitos y se rechazan antes de publicar, sin truncar el video.

Migraciones 0133–0136 crean snapshots con payload/hash inmutables y puntero activo. Guardar crea candidata y recibo CAS; activar comprueba nuevamente fuentes/propiedad, conserva historial e invalida jobs dependientes. Cambiar escenas/guion vuelve obsoleto el montaje sin reescribirlo. Render/QA deberán comprobar ese mismo gate.

Preview usa la composición Remotion con fuentes privadas de sesión y tickets temporales, renovadas por acción del usuario. LOCAL_ONLY se señala como no disponible en web. Los medios no se incorporan al bundle ni se sustituyen silenciosamente durante el render local. Movimiento por frame determinista; dissolve de hasta 15 frames conserva el último frame de la toma anterior durante la transición, sin añadir duración al timeline.

Se fijó Remotion/Player 4.0.544, compatible con React 19.3.1 existente. Remotion publica un tipo Bun `Timer` sin calificar; una declaración local lo relaciona con el setTimeout del runtime. Las declaraciones multimedia de Remotion duplican vite/client: la web declara solo el MODE que utiliza y CSS. No se modifica node_modules ni se activa skipLibCheck. Domain/render conservan exports TS fuente y validan build sin emitir árboles duplicados de workspaces, como testkit; el frontend y el agente empaquetan los consumidores. Domain solo añade tipos WHATWG WebWorker, sin Node.

Fuentes oficiales: [Remotion renderer](https://www.remotion.dev/docs/renderer), [bundle](https://www.remotion.dev/docs/bundle), [Player](https://www.remotion.dev/docs/player). La versión fue contrastada en el registro oficial al instalar. [Licencia](https://www.remotion.dev/docs/license/pricing) y [telemetría](https://www.remotion.dev/docs/telemetry): este sistema privado de un propietario se desarrolla con fixtures, sin adquirir licencia o servicio. Antes de otro contexto organizacional deberá comprobarse la elegibilidad correspondiente; no se presume una licencia comercial pagada.
