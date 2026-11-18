import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { projectInputFixture } from '@video-studio/testkit';
import { researchData } from '../support/content.js';
test.use({ baseURL: 'http://127.0.0.1:4174', storageState: process.env.VIDEO_STUDIO_E2E_MEDIA_STATE });
test('F5-03 · prompt, JSON inválido, respuesta perdida y reanudación manual privada', async ({ page }) => {
  test.setTimeout(90000); const headers = { origin: 'http://127.0.0.1:4174', 'idempotency-key': crypto.randomUUID() };
  const response = await page.request.post('/api/v1/projects', { headers, data: { ...projectInputFixture(), title: 'Manual de prueba', wizardStep: 5 } });
  expect(response.status()).toBe(201); const p = await response.json() as { id: string; revision: number }; const current = p;
    const started = await page.request.post(`/api/v1/projects/${p.id}/start`, { headers: { ...headers, 'idempotency-key': crypto.randomUUID() }, data: { expectedRevision: current.revision } }); expect(started.status()).toBe(202); const start = await started.json() as { job: { id: string } };
    await page.goto(`/generations/${start.job.id}/manual`);
    await expect(page.getByLabel('Prompt para copiar')).toBeVisible(); await page.getByLabel('JSON del resultado').fill('{'); await page.getByRole('button', { name: 'Validar y guardar resultado' }).click(); await expect(page.getByRole('alert')).toContainText('JSON inválido');
    await page.getByLabel('JSON del resultado').fill(JSON.stringify({ kind: 'RESEARCH', data: researchData() }));
    await page.route('**/api/v1/jobs/*/manual', async (route) => { if (route.request().method() !== 'POST') { await route.continue(); return; } await route.fetch(); await route.abort('failed'); }, { times: 1 });
    await page.getByRole('button', { name: 'Validar y guardar resultado' }).click(); await expect(page.getByRole('button', { name: 'Reintentar operación' })).toBeVisible(); await page.getByRole('button', { name: 'Reintentar operación' }).click(); await expect(page.getByText(/^Resultado guardado/)).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]); await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
