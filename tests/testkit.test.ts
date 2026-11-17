import { describe, expect, it } from 'vitest';
import { projectDtoSchema, projectInputSchema, uuidSchema } from '@video-studio/contracts';
import { fixtureId, FIXTURE_TIMESTAMP, projectDtoFixture, projectInputFixture } from '@video-studio/testkit';

describe('testkit determinista y aislado', () => {
  it('genera fixtures válidas, sin reloj real, credenciales ni fallback de pago', () => {
    const input = projectInputSchema.parse(projectInputFixture());
    expect(input.settings.budget.maxMicros).toBe(0);
    expect(input.settings.providerPolicy.allowPaidFallback).toBe(false);
    const dto = projectDtoSchema.parse(projectDtoFixture());
    expect(dto.createdAt).toBe(FIXTURE_TIMESTAMP);
    expect(dto.updatedAt).toBe(FIXTURE_TIMESTAMP);
    expect(projectDtoFixture()).toEqual(projectDtoFixture());
  });

  it('no comparte objetos mutables entre llamadas', () => {
    const first = projectInputFixture();
    first.settings.budget.maxMicros = 10;
    first.settings.providerPolicy.preferredIds.push(fixtureId(1));
    first.settings.checkpoints.push('OTHER');
    const second = projectInputFixture();
    expect(second.settings.budget.maxMicros).toBe(0);
    expect(second.settings.providerPolicy.preferredIds).toEqual([]);
    expect(second.settings.checkpoints).toEqual(['SCRIPT', 'DIRECTION']);
  });

  it('IDs estables y distintos por índice, también en el extremo de 48 bits', () => {
    const ids = [0, 1, 2, 0xffffffffffff].map(fixtureId);
    expect(new Set(ids).size).toBe(4);
    ids.forEach((id) => expect(uuidSchema.safeParse(id).success).toBe(true));
    expect(fixtureId(2)).toBe(fixtureId(2));
  });

  it.each([-1, 0.5, NaN, 0x1000000000000])('rechaza índice de fixture inválido: %s', (index) => {
    expect(() => fixtureId(index)).toThrow(RangeError);
  });
});
