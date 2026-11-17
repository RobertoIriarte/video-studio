import type { ProjectDto, ProjectInput, ProjectSettings } from '@video-studio/contracts';
export * from './catalog.js';

export const FIXTURE_TIMESTAMP = '2026-11-17T00:00:00.000Z';

// IDs de prueba, no generador de identidad para producción.
export function fixtureId(index = 0): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffffffff) {
    throw new RangeError('El índice de fixture debe caber en 48 bits sin signo.');
  }
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

export function projectSettingsFixture(overrides: Partial<ProjectSettings> = {}): ProjectSettings {
  return {
    language: 'es', audience: 'Público general', objective: 'YOUTUBE_LONG',
    targetDurationMs: 15 * 60 * 1000, style: 'DOCUMENTARY', modality: 'DYNAMIC_IMAGES', mode: 'SUPERVISED',
    budget: { currency: 'USD', maxMicros: 0 },
    providerPolicy: { allowPaidFallback: false, preferredIds: [] },
    checkpoints: ['SCRIPT', 'DIRECTION'],
    ...overrides,
  };
}

export function projectInputFixture(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    title: 'Historia de muestra', inputType: 'TOPIC', inputText: 'Un tema sintético para las pruebas.',
    settings: projectSettingsFixture(), ...overrides,
  };
}

export function projectDtoFixture(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: fixtureId(), title: 'Historia de muestra', inputType: 'TOPIC', status: 'DRAFT', revision: 1,
    settings: projectSettingsFixture(), createdAt: FIXTURE_TIMESTAMP, updatedAt: FIXTURE_TIMESTAMP,
    ...overrides,
  };
}
