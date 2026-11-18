import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.use({ baseURL: 'http://127.0.0.1:4174', storageState: process.env.VIDEO_STUDIO_E2E_MEDIA_STATE });
test('F5-02 · vinculación, estado real y revocación desde configuración', async ({ page }) => {
  await page.goto('/settings'); await page.getByLabel('Nombre de referencia').fill('Equipo E2E');
  await page.getByRole('button', { name: 'Crear código de vinculación' }).click();
  const code = await page.locator('.library-asset code').textContent();
  const paired = await page.request.post('/api/v1/agents/pair', { headers: { 'idempotency-key': crypto.randomUUID() }, data: { code, name: 'Equipo E2E', capabilities: { ffprobe: true, localImport: true, alignment: false } } });
  expect(paired.status()).toBe(200); const agent = await paired.json() as { token: string; agentId: string };
  const beat = () => page.request.post('/api/v1/agents/heartbeat', { headers: { authorization: `Bearer ${agent.token}`, 'idempotency-key': crypto.randomUUID() }, data: { capabilities: { ffprobe: true, localImport: true, alignment: false }, diskFreeBytes: 2000000000, activeJobIds: [], probeVersion: 'Fixture de interfaz' } });
  expect((await beat()).status()).toBe(200); await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Equipo E2E', exact: true })).toBeVisible(); await expect(page.getByText(/^Conectado · Última señal/)).toBeVisible();
  await page.getByRole('button', { name: 'Ocultar código' }).click(); expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Revocar acceso de Equipo E2E' }).click(); await page.getByRole('button', { name: 'Confirmar revocación' }).click();
  await expect(page.getByText(/^Revocado · Última señal/)).toBeVisible(); expect((await beat()).status()).toBe(401);
  await page.goto('/providers'); await expect(page.getByRole('heading', { name: 'Integraciones evaluadas' })).toBeVisible(); await expect(page.getByRole('heading', { name: 'Google Flow · video' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
