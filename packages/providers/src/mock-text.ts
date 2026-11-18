import type { ProviderContext } from './index.js';

export type MockTextRequest = { role: 'RESEARCH' | 'SCRIPT'; title: string; inputText: string; inputType: string; language: string; targetDurationMs: number; now: string };
// Solo fixtures explícitas: no red, no referencias inventadas ni hechos presentados como verificados.
export class MockTextAdapter {
  capabilities() { return { operations: ['STRUCTURED_TEXT'], simulated: true }; }
  validate(request: MockTextRequest) { if (!request.inputText || request.targetDurationMs < 1) throw new Error('INVALID_INPUT'); }
  async estimate() { return { amountMicros: 0, units: 1 }; }
  async start(request: MockTextRequest, context: ProviderContext): Promise<unknown> {
    this.validate(request); context.signal.throwIfAborted();
    const metadata = { schemaVersion: 1, promptVersion: `${request.role.toLowerCase()}-mock-v1`, model: 'deterministic-fixture-v1', simulated: true, language: request.language };
    if (request.role === 'RESEARCH') {
      const urls = [...new Set(request.inputText.match(/https?:\/\/[^\s<>"']+/g) ?? [])].slice(0, 32).filter((url) => url.length <= 2048);
      return { metadata, sources: urls.map((url, index) => ({ key: `source-${index + 1}`, url, title: `Referencia aportada ${index + 1}`, notes: 'URL aportada por el usuario; no consultada ni verificada.', acquiredAt: request.now, provenance: 'MANUAL', accessStatus: 'UNKNOWN' })),
        claims: [], outlineSuggestions: [request.title], uncertainties: ['Simulación sin investigación externa. Verificar las afirmaciones antes de producir.'] };
    }
    const count = Math.ceil(request.targetDurationMs / 60000);
    if (count > 100) throw new Error('INVALID_INPUT');
    const words = request.inputText.split(/\s+/); const own = request.inputType === 'SCRIPT';
    const sections = Array.from({ length: own ? Math.min(count, words.length) : count }, (_, i) => i);
    const total = sections.length; const base = Math.floor(request.targetDurationMs / total);
    const chunks = sections.map((i) => own ? words.slice(Math.floor(i * words.length / total), Math.floor((i + 1) * words.length / total)).join(' ') : `Simulación ${i + 1}: ${request.title}. Contenido pendiente de investigación y edición.`);
    if (chunks.some((c) => c.length > 16000)) throw new Error('INVALID_INPUT');
    return { metadata, title: request.title, hook: 'Apertura de simulación.', sections: chunks.map((narration, i) => ({ stableKey: `section-${i + 1}`, title: `${request.title.slice(0, 185)} · ${i + 1}`, narration, claimIds: [], targetDurationMs: base + (i < request.targetDurationMs % total ? 1 : 0) })), closing: 'Cierre de simulación.', approximateWords: chunks.join(' ').split(/\s+/).length, riskNotes: ['Contenido simulado; no sustituye revisión editorial.'] };
  }
}

export type MockDirectionRequest = { stableKey: string; narration: string; durationMs: number; language: string; palette: string[]; light: string; mood: string; framing: string; shots: { durationMs: number; assetType: string }[] };
export class MockDirectorAdapter {
  async start(r: MockDirectionRequest, context: ProviderContext): Promise<unknown> {
    context.signal.throwIfAborted();
    return { metadata: { schemaVersion: 1, promptVersion: 'director-mock-v1', model: 'deterministic-fixture-v1', simulated: true, language: r.language },
      visualBible: { presetVersion: 1, palette: r.palette, characters: [], locations: [], continuity: 'Mantener paleta, iluminación y referencias autorizadas entre tomas.', referenceAssetIds: [] },
      warnings: ['Plan simulado. Duración orientativa hasta importar voz real. Sin recursos generados.'],
      scenes: [{ stableKey: r.stableKey, narration: r.narration, durationMs: r.durationMs, musicMood: r.mood, sfx: [], continuityNotes: 'Continuidad de sujeto y eje; verificar al producir.',
        shotPlans: r.shots.map((s, i) => ({ ...s, subject: r.narration.slice(0, 1000), composition: i % 2 ? 'Detalle complementario' : 'Contexto del sujeto', framing: r.framing, cameraMotion: s.assetType === 'GRAPHIC' ? 'Composición programática' : i % 2 ? 'Desplazamiento suave' : 'Cámara fija', light: r.light, mood: r.mood,
          visualPrompt: `Plan simulado (${r.language}), toma ${i + 1}: ${r.narration.slice(0, 2000)}`, negativePrompt: 'Sin texto generado, marcas de agua ni logos.', refs: [], startFrame: null, endFrame: null, transition: 'CUT', audioCue: '', licenseRequirement: 'Usar recursos propios o con licencia autorizada; comprobar procedencia.' })) }] };
  }
}
