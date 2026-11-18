import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { bytesHash } from '@video-studio/contracts';
import { wavFixture } from '../support/media.js';
test.use({ baseURL: 'http://127.0.0.1:4174', storageState: process.env.VIDEO_STUDIO_E2E_MEDIA_STATE });
test('F5-04 · WAV importado, duración real, segmentos estimados y candidata revisable', async ({ page }) => {
  const project = '00000000-0000-4000-8000-00000000a510'; const scene = '00000000-0000-4000-8000-00000000a512'; const headers = { origin: 'http://127.0.0.1:4174', 'idempotency-key': crypto.randomUUID() }; const bytes = wavFixture(1250);
  const intent = await page.request.post('/api/v1/assets/import', { headers, data: { projectId: project, mime: 'audio/wav', bytes: bytes.length, checksum: await bytesHash(bytes), license: { source: 'Fixture WAV propio', note: '', rightsAcknowledged: true }, prompt: null } }); expect(intent.status()).toBe(201); const asset = await intent.json() as { id: string };
  expect((await page.request.put(`/api/v1/imports/${asset.id}/content`, { headers: { origin: headers.origin, 'content-type': 'application/octet-stream' }, data: bytes })).status()).toBe(200);
  expect((await page.request.post(`/api/v1/assets/${asset.id}/finalize`, { headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, data: {} })).status()).toBe(200);
  const detail = await (await page.request.get(`/api/v1/scenes/${scene}`)).json() as { revision: number; scene: { activeVersionId: string } };
  const request = await page.request.post(`/api/v1/scenes/${scene}/regenerate`, { headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, data: { expectedRevision: detail.revision, baseVersionId: detail.scene.activeVersionId, scope: 'VOICE', instruction: '', providerId: null } }); expect(request.status()).toBe(202); const job = await request.json() as { id: string };
  await page.goto(`/generations/${job.id}/manual`); await page.getByLabel('Seleccionar audio de Biblioteca').selectOption(asset.id); await page.getByRole('button', { name: 'Validar y guardar resultado' }).click(); await expect(page.getByText(/^Resultado guardado/)).toBeVisible();
  await page.goto(`/projects/${project}/scenes/${scene}`); await expect(page.getByRole('heading', { name: 'Segmentos de voz' })).toBeVisible(); await expect(page.getByText('Tiempos estimados; requieren revisión auditiva.')).toBeVisible(); await expect(page.getByText(/1250 ms:/)).toBeVisible(); await expect(page.getByRole('button', { name: 'Usar versión de escena' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]); await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
