import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.use({ baseURL: 'http://127.0.0.1:4174', storageState: process.env.VIDEO_STUDIO_E2E_MEDIA_STATE });
test('F6-01 · snapshot, preview Remotion, edición candidata y activación exacta', async ({ page }) => {
  await page.goto('/projects/00000000-0000-4000-8000-00000000a520/edit'); await page.getByRole('button',{ name: 'Crear snapshot de escenas activas' }).click(); await expect(page.getByRole('heading',{ name: 'Plan de montaje · v1' })).toBeVisible();
  await page.getByRole('button',{ name: 'Cargar o renovar preview' }).click(); await expect(page.getByText('0 recursos sin copia remota; su preview requiere el equipo local.')).toBeVisible(); await page.getByRole('button',{ name: 'Editar montaje', exact: true }).click(); await page.getByRole('combobox', { name: 'Movimiento', exact: true }).first().selectOption('PULL_OUT');
  await page.getByRole('button',{ name: 'Guardar candidata de montaje' }).click(); await expect(page.getByRole('heading',{ name: 'Plan de montaje · v2' })).toBeVisible(); await page.getByRole('button',{ name: 'Usar montaje', exact: true }).click(); await page.getByRole('button',{ name: 'Confirmar montaje', exact: true }).click(); await expect(page.getByText('Montaje activo vigente.')).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()).violations).toEqual([]); await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
