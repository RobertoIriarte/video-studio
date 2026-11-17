/** Suma duraciones positivas en milisegundos, sin reloj, I/O ni estado global. */
export function sumDurationMs(durations: readonly number[]): number {
  let total = 0;
  for (const duration of durations) {
    if (!Number.isSafeInteger(duration) || duration <= 0) {
      throw new RangeError('Cada duración debe ser un entero positivo seguro.');
    }
    if (duration > Number.MAX_SAFE_INTEGER - total) {
      throw new RangeError('La duración total excede el rango entero seguro.');
    }
    total += duration;
  }
  return total;
}
