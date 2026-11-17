import { describe, expect, it } from 'vitest';
import { sumDurationMs } from '@video-studio/domain';

describe('dominio puro · aritmética exacta de duración', () => {
  it('suma ms sin redondear ni mutar el input', () => {
    const durations = Object.freeze([1000, 2500, 500]);
    expect(sumDurationMs(durations)).toBe(4000);
    expect(durations).toEqual([1000, 2500, 500]);
    expect(sumDurationMs([])).toBe(0);
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rechaza duración inválida: %s', (value) => {
    expect(() => sumDurationMs([value])).toThrow(RangeError);
  });

  it('acepta el límite seguro y rechaza overflow antes de perder precisión', () => {
    expect(sumDurationMs([Number.MAX_SAFE_INTEGER - 1, 1])).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => sumDurationMs([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});
