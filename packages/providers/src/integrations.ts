// Reviewed public documentation, not probes of the owner's accounts or subscriptions.
const common = { status: 'MANUAL_ONLY', automatic: false, requiresUserAction: true, costKnown: false, reviewedOn: '2026-11-18' } as const;
export const integrationReviews = [
  { ...common, key: 'CHATGPT_TEXT', kind: 'TEXT', name: 'ChatGPT · texto', toolUrl: 'https://chatgpt.com/', importFormats: ['application/json'],
    reason: 'Copia prompt y referencias; importa JSON validado. API sin configurar ni presupuesto autorizado. Los posibles créditos API de planes elegibles requieren activación y comprobación en una organización propia.', sources: ['https://developers.openai.com/api/docs/guides/chatgpt-api-credits', 'https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform'] },
  { ...common, key: 'CHATGPT_IMAGE', kind: 'IMAGE', name: 'ChatGPT · imagen', toolUrl: 'https://chatgpt.com/', importFormats: ['image/png', 'image/jpeg', 'image/webp'],
    reason: 'Generación por el usuario e importación con licencia. Existe API oficial, pero no hay integración automática ni credencial autorizada en este proyecto.', sources: ['https://developers.openai.com/api/docs/guides/image-generation'] },
  { ...common, key: 'FLOW_VIDEO', kind: 'VIDEO', name: 'Google Flow · video', toolUrl: 'https://flow.google.com/', importFormats: ['video/mp4'],
    reason: 'Genera y descarga desde Flow, respetando créditos, límites y procedencia. La API Gemini es una vía independiente sin habilitar; no se usan endpoints privados de Flow ni se fijan modelos retirados.', sources: ['https://support.google.com/flow/answer/16526234?hl=en', 'https://aistudio.google.com/docs/video'] },
  { ...common, key: 'IMPORTED_VOICE', kind: 'VOICE', name: 'Voz importada', toolUrl: null, importFormats: ['audio/wav', 'audio/mpeg', 'audio/ogg'],
    reason: 'Proveedor de voz pendiente de selección. Importa audio autorizado con duración real y tiempos manuales o estimados revisables. El mock es un tono de pruebas, no voz hablada.', sources: ['https://developers.openai.com/api/docs/guides/text-to-speech'] },
  { ...common, key: 'LICENSED_STOCK', kind: 'STOCK', name: 'Stock autorizado', toolUrl: null, importFormats: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'audio/wav', 'audio/mpeg', 'audio/ogg'],
    reason: 'Importación de archivos propios o con licencia comprobada. No hay búsqueda, scraping ni descarga automática de bibliotecas externas.', sources: [] },
] as const;
