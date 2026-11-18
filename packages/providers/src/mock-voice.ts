import type { ProviderContext } from './index.js';
// Synthetic tone for fixtures. This adapter does not produce narrated speech.
export class MockVoiceAdapter {
  capabilities() { return { simulated: true, speech: false, format: 'audio/wav' as const, maxDurationMs: 5000 }; }
  validate(input: { durationMs: number }) { if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > 5000) throw new Error('INVALID_INPUT'); }
  async estimate(input: { durationMs: number }) { this.validate(input); return { amountMicros: 0, units: 1, costKnown: true as const, simulated: true as const }; }
  async start(input: { durationMs: number }, context: ProviderContext) {
    context.signal.throwIfAborted(); this.validate(input); const rate = 8000; const samples = input.durationMs * 8; const bytes = new Uint8Array(44 + samples * 2); const view = new DataView(bytes.buffer);
    const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
    text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 1000), true);
    return { bytes, mime: 'audio/wav' as const, durationMs: input.durationMs, simulated: true as const, speech: false as const };
  }
}
