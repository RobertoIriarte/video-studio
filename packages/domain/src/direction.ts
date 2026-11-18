export function planShotDurations(durationMs: number): number[] {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 128000) throw new RangeError('SCENE_DURATION_REQUIRES_SPLIT');
  const count = Math.min(durationMs, Math.max(2, Math.ceil(durationMs / 8000)));
  const base = Math.floor(durationMs / count); const remainder = durationMs % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
export function modalityAssetType(modality: string, shot: number): 'IMAGE' | 'VIDEO' | 'GRAPHIC' {
  switch (modality) { case 'DYNAMIC_IMAGES': return 'IMAGE'; case 'HYBRID': return shot % 2 ? 'VIDEO' : 'IMAGE'; case 'CINEMATIC': return 'VIDEO'; case 'EXPLAINER': return 'GRAPHIC'; default: throw new Error('INVALID_MODALITY'); }
}
export function directionPreset(style: string) {
  switch (style) {
    case 'DOCUMENTARY': return { palette: ['neutros naturales', 'ámbar'], light: 'Luz natural motivada', mood: 'Observación documental', framing: 'Plano general y detalle contextual' };
    case 'PREMIUM_REALISTIC': return { palette: ['neutros cálidos', 'azul profundo'], light: 'Luz suave controlada', mood: 'Realismo cuidado', framing: 'Composición limpia con profundidad' };
    case 'HORROR_MYSTERY': return { palette: ['azul oscuro', 'verde desaturado'], light: 'Contraste bajo y sombras motivadas', mood: 'Misterio sin violencia gráfica', framing: 'Espacio negativo y detalle sugerente' };
    default: throw new Error('INVALID_STYLE');
  }
}
