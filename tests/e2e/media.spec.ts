import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { pngFixture, wavFixture } from '../support/media.js';
test.use({ baseURL: 'http://127.0.0.1:4174', actionTimeout: 10000, storageState: process.env.VIDEO_STUDIO_E2E_MEDIA_STATE });
test('F5-01 · biblioteca privada, PNG/WAV reales sintéticos, filtros y recuperación de subida', async ({ page }) => {
  test.setTimeout(90000); await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Biblioteca privada', exact: true })).toBeVisible();
  // Proyecto sintético aislado del wizard E2E, para no depender del orden de tests.
  const { projectInputFixture } = await import('@video-studio/testkit');
  const response = await page.request.post('/api/v1/projects', { headers: { origin: 'http://127.0.0.1:4174', 'idempotency-key': crypto.randomUUID() }, data: { ...projectInputFixture(), title: 'Biblioteca de prueba' } }); expect(response.status()).toBe(201); const project = await response.json() as { id: string };
  await page.goto(`/library?projectId=${project.id}`); await page.getByLabel('Archivo', { exact: true }).setInputFiles({ name: '../../fixture.png', mimeType: 'image/png', buffer: pngFixture() }); await page.getByLabel('Procedencia o licencia', { exact: true }).fill('Recurso sintético propio'); await page.getByRole('checkbox').check();
  await page.route('**/api/v1/imports/*/content', async (route) => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
  await page.getByRole('button', { name: 'Importar recurso', exact: true }).click(); await expect(page.getByRole('button', { name: 'Reintentar importación pendiente', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Reintentar importación pendiente', exact: true }).click();
  await expect(page.getByText('Recurso verificado y disponible en la biblioteca.', { exact: true })).toBeVisible(); await expect(page.getByAltText('Recurso privado importado')).toBeVisible(); expect(await page.getByAltText('Recurso privado importado').evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(2);
  await page.getByLabel('Archivo', { exact: true }).setInputFiles({ name: 'fixture.wav', mimeType: 'audio/wav', buffer: wavFixture() }); await page.getByRole('button', { name: 'Importar recurso', exact: true }).click(); await expect(page.getByRole('heading', { name: /^Audio ·/ })).toBeVisible();
  await page.getByLabel('Tipo de recurso', { exact: true }).selectOption('AUDIO'); await expect(page.getByRole('heading', { name: /^Audio ·/ })).toHaveCount(1); await expect(page.getByRole('heading', { name: /^Imagen ·/ })).toHaveCount(0); await page.reload(); await expect(page.getByRole('heading', { name: /^Audio ·/ })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]); await page.setViewportSize({ width: 390, height: 844 }); const overflow = await page.evaluate(() => ({ ok: document.documentElement.scrollWidth <= innerWidth, nodes: Array.from(document.querySelectorAll('*')).filter((el) => el.getBoundingClientRect().right > innerWidth + 1).slice(-8).map((el) => ({ tag: el.tagName, cls: el.className, right: el.getBoundingClientRect().right })) })); expect(overflow.ok, JSON.stringify(overflow.nodes)).toBe(true); await page.screenshot({ path: 'test-results/library-mobile.png' });
});
