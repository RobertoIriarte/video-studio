import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema, createProjectInputSchema, currencySchema, DEFAULT_MAX_INPUT_BYTES,
  healthResponseSchema, instructionSchema, paginatedResponseSchema, paginationQuerySchema,
  projectDtoSchema, projectInputSchema, safeValidationIssues, validationIssueSchema, versionResponseSchema,
} from '@video-studio/contracts';
import { fixtureId, projectDtoFixture, projectInputFixture, projectSettingsFixture } from '@video-studio/testkit';

function rejected(input: unknown, schema = projectInputSchema) {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Se esperaba rechazo del contrato.');
  const issues = safeValidationIssues(result.error);
  expect(issues.length).toBeGreaterThan(0);
  for (const issue of issues) expect(validationIssueSchema.safeParse(issue).success).toBe(true);
  return issues;
}

describe('T01 · contratos de proyecto compartidos', () => {
  it.each(['TOPIC', 'SCRIPT', 'SOURCES'] as const)('acepta entrada %s y recorta texto/título', (inputType) => {
    const result = projectInputSchema.parse(projectInputFixture({ inputType, title: '  Historia  ', inputText: '  Texto de muestra  ' }));
    expect(result.title).toBe('Historia');
    expect(result.inputText).toBe('Texto de muestra');
    expect(result.inputType).toBe(inputType);
  });

  it.each([null, {}, '', { title: 'Sin contenido' }])('rechaza estructura incompleta: %j', (value) => {
    rejected(value);
  });

  it.each(['title', 'inputText'] as const)('rechaza %s vacío o solo espacios', (field) => {
    for (const value of ['', ' \n\t ']) {
      expect(rejected({ ...projectInputFixture(), [field]: value })).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: [field] }),
      ]));
    }
  });

  it.each([
    { inputType: 'URL' },
    { settings: { ...projectSettingsFixture(), style: 'VIRAL' } },
    { settings: { ...projectSettingsFixture(), modality: '4K' } },
    { settings: { ...projectSettingsFixture(), mode: 'MANUAL' } },
    { settings: { ...projectSettingsFixture(), objective: 'YOUTUBE_SHORT' } },
  ])('rechaza enums ajenos al contrato: %j', (override) => {
    rejected({ ...projectInputFixture(), ...override });
  });

  it.each([-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rechaza duración no válida: %s', (targetDurationMs) => {
    const issues = rejected(projectInputFixture({ settings: projectSettingsFixture({ targetDurationMs }) }));
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['settings', 'targetDurationMs'] })]));
  });

  it('aplica límites de título e instrucción en sus extremos', () => {
    expect(projectInputSchema.safeParse(projectInputFixture({ title: 'a'.repeat(200) })).success).toBe(true);
    rejected(projectInputFixture({ title: 'a'.repeat(201) }));
    expect(instructionSchema.parse('')).toBe('');
    expect(instructionSchema.safeParse('a'.repeat(4000)).success).toBe(true);
    expect(instructionSchema.safeParse('a'.repeat(4001)).success).toBe(false);
  });

  it('limita bytes UTF-8 antes de trim, incluyendo acentos y emoji', () => {
    const schema = createProjectInputSchema({ maxInputBytes: 8 });
    for (const inputText of ['12345678', 'áááá', '😀😀']) {
      expect(schema.safeParse(projectInputFixture({ inputText })).success).toBe(true);
      rejected(projectInputFixture({ inputText: `${inputText}a` }), schema);
    }
    rejected(projectInputFixture({ inputText: '        a' }), schema);
    rejected(projectInputFixture({ inputText: 'a'.repeat(DEFAULT_MAX_INPUT_BYTES + 1) }));
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('no permite configuración de tamaño inválida: %s', (maxInputBytes) => {
    expect(() => createProjectInputSchema({ maxInputBytes })).toThrow(RangeError);
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rechaza presupuesto no entero/no seguro: %s', (maxMicros) => {
    rejected(projectInputFixture({ settings: projectSettingsFixture({ budget: { currency: 'USD', maxMicros } }) }));
  });

  it('valida moneda/idioma, UUIDs de referencia y campos desconocidos sin autorizar proveedores', () => {
    for (const currency of ['USD', 'CLP', 'EUR']) expect(currencySchema.safeParse(currency).success).toBe(true);
    for (const currency of ['ZZZ', 'usd', 'US']) expect(currencySchema.safeParse(currency).success).toBe(false);
    rejected(projectInputFixture({ settings: projectSettingsFixture({ language: 'es_@@' }) }));
    rejected(projectInputFixture({ settings: projectSettingsFixture({ providerPolicy: { allowPaidFallback: false, preferredIds: ['no-uuid'] } }) }));
    rejected(projectInputFixture({ settings: projectSettingsFixture({ providerPolicy: { allowPaidFallback: false, preferredIds: [fixtureId(), fixtureId()] } }) }));
    rejected({ ...projectInputFixture(), ownerId: fixtureId(1) });
    rejected({ ...projectInputFixture(), settings: { ...projectSettingsFixture(), secret: 'private-marker' } });
  });

  it('produce errores acotados sin reflejar valores, mensajes internos ni stack', () => {
    const issues = rejected({ ...projectInputFixture(), inputType: 'private-marker' });
    expect(issues).toEqual([expect.objectContaining({ path: ['inputType'], message: 'Valor no válido.' })]);
    expect(JSON.stringify(issues)).not.toContain('private-marker');
    expect(JSON.stringify(issues)).not.toContain('stack');
    const many = rejected(projectInputFixture({ settings: projectSettingsFixture({
      providerPolicy: { allowPaidFallback: false, preferredIds: Array<string>(32).fill('private-marker') },
    }) }));
    expect(many).toHaveLength(20);
    expect(JSON.stringify(many)).not.toContain('private-marker');
  });
});

describe('DTO y paginación base', () => {
  it('valida el DTO público y rechaza IDs/revisiones/timestamps y campos privados inválidos', () => {
    const dto = projectDtoFixture();
    expect(projectDtoSchema.parse(dto)).toEqual(dto);
    for (const override of [
      { id: 'not-uuid' }, { revision: 0 }, { revision: 1.5 }, { status: 'UNKNOWN' },
      { createdAt: '2026-11-17T00:00:00-03:00' }, { updatedAt: 'not-a-date' }, { tokenHash: 'private-marker' },
    ]) expect(projectDtoSchema.safeParse({ ...dto, ...override }).success).toBe(false);
  });

  it('aplica default 25, acepta límites HTTP decimales y bloquea coerciones ambiguas', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(paginationQuerySchema.parse({ limit: '100', cursor: 'opaque-cursor' })).toEqual({ limit: 100, cursor: 'opaque-cursor' });
    for (const limit of [0, -1, 101, 1.5, true, '', '1e2', '100.0', 'NaN']) {
      expect(paginationQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(paginationQuerySchema.safeParse({ cursor: ' ' }).success).toBe(false);
  });

  it('conserva el formato de lista items/nextCursor y el máximo 100', () => {
    const schema = paginatedResponseSchema(projectDtoSchema);
    expect(schema.parse({ items: [projectDtoFixture()], nextCursor: null }).items).toHaveLength(1);
    expect(schema.safeParse({ items: [], nextCursor: 'opaque-cursor' }).success).toBe(true);
    expect(schema.safeParse({ items: [] }).success).toBe(false);
    expect(schema.safeParse({ items: Array.from({ length: 101 }, () => projectDtoFixture()), nextCursor: null }).success).toBe(false);
  });
});

describe('compatibilidad F1-02: wire v1 sin cambios', () => {
  it('mantiene health y version exactos', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
    expect(versionResponseSchema.parse({ apiVersion: 'v1', version: '0.0.0' })).toEqual({ apiVersion: 'v1', version: '0.0.0' });
  });

  it.each(['NOT_FOUND', 'INTERNAL_ERROR', 'SERVICE_UNAVAILABLE'])('conserva el sobre de error existente %s', (code) => {
    const legacy = { error: { code, message: 'Mensaje seguro.', requestId: fixtureId(), retryable: false, details: { reason: 'safe' } } };
    expect(apiErrorSchema.parse(legacy)).toEqual(legacy);
  });
});
