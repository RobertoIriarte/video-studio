// Metadata estimation only: no speech recognition or forced alignment is claimed.
export function estimateVoiceTimings(narration: string, durationMs: number) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 21600000 || !narration.trim() || narration.length > 64000) throw new Error('INVALID_VOICE_TIMING');
  const words = narration.trim().split(/\s+/u); const count = Math.min(256, words.length, durationMs); const group = Math.ceil(words.length / count); const chunks: string[] = [];
  for (let i = 0; i < words.length; i += group) chunks.push(words.slice(i, i + group).join(' '));
  let used = 0; return chunks.map((text, segmentIndex) => { const startMs = used; used = segmentIndex === chunks.length - 1 ? durationMs : Math.floor((segmentIndex + 1) * durationMs / chunks.length); return { segmentIndex, text, startMs, endMs: used }; });
}
export function retimeShots<T extends { durationMs: number }>(shots: readonly T[], durationMs: number): T[] {
  if (!Number.isSafeInteger(durationMs) || durationMs < Math.max(1, shots.length) || shots.some((s) => !Number.isSafeInteger(s.durationMs) || s.durationMs < 1)) throw new Error('INVALID_SHOT_TIMING');
  const total = shots.reduce((n, s) => n + BigInt(s.durationMs), 0n); const free = durationMs - shots.length; let weight = 0n; let used = 0;
  return shots.map((s, i) => { weight += BigInt(s.durationMs); const until = i === shots.length - 1 ? free : Number(weight * BigInt(free) / total); const result = { ...s, durationMs: 1 + until - used }; used = until; return result; });
}
