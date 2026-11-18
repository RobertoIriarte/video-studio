import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.use({ baseURL: 'http://127.0.0.1:4174' });
test('wizard real: tres entradas, recarga, revisión, protección de cambios y archivo', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/projects');
  await page.getByLabel('Correo', { exact: true }).fill('e2e@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.VIDEO_STUDIO_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Proyectos', exact: true })).toBeVisible();
  let releaseRead: () => void = () => undefined;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  let holdFirstRead = true;
  await page.route('**/api/v1/projects/*', async (route) => {
    if (route.request().method() === 'GET' && holdFirstRead) {
      holdFirstRead = false;
      const response = await route.fetch();
      await readGate;
      await route.fulfill({ response });
    } else await route.continue();
  });
  for (const type of ['TOPIC', 'SCRIPT', 'SOURCES']) {
    await page.getByRole('link', { name: 'Nuevo proyecto' }).click();
    await page.getByLabel('Tipo de entrada').selectOption(type);
    await page.getByLabel('Título', { exact: true }).fill(`Historia ${type}`);
    await page.locator('textarea').fill(`Contenido sintético ${type} con fuentes propias.`);
    await page.getByRole('button', { name: 'Guardar y continuar' }).click();
    if (type === 'TOPIC') {
      await expect(page.getByRole('status')).toHaveText('Abriendo borrador…');
      releaseRead();
    }
    await expect(page.getByRole('heading', { name: 'Paso 2 de 5' })).toBeVisible();
    await page.getByLabel('Audiencia', { exact: true }).fill('Audiencia persistida');
    await page.getByLabel('Duración objetivo').fill('15');
    await page.getByRole('button', { name: 'Guardar y continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Paso 3 de 5' })).toBeVisible();
    await page.getByRole('button', { name: 'Atrás', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Paso 2 de 5' })).toBeVisible();
    await expect(page.getByLabel('Audiencia', { exact: true })).toHaveValue('Audiencia persistida');
    await page.getByRole('button', { name: 'Guardar y continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Paso 3 de 5' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Paso 3 de 5' })).toBeVisible();
    await page.getByLabel('Terror / misterio', { exact: true }).check();
    await page.getByLabel('Híbrida · costo relativo medio', { exact: true }).check();
    if (type === 'TOPIC') await page.screenshot({ path: 'test-results/private-wizard.png', fullPage: true });
    await page.getByRole('button', { name: 'Guardar y continuar' }).click();
    await page.getByRole('combobox', { name: 'Modo', exact: true }).selectOption('AUTO');
    await page.getByRole('button', { name: 'Guardar y continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Paso 5 de 5' })).toBeVisible();
    await expect(page.getByText('es · Audiencia persistida · 15 min', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar y guardar proyecto' }).click();
    await expect(page.getByRole('heading', { name: `Historia ${type}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Iniciar producción', exact: true })).toBeEnabled();
    if (type === 'TOPIC') {
      await page.getByRole('link', { name: 'Continuar configuración' }).click();
      for (let step = 5; step > 1; step--) { await expect(page.getByRole('heading', { name: `Paso ${step} de 5` })).toBeVisible(); await page.getByRole('button', { name: 'Atrás', exact: true }).click(); }
      await page.getByLabel('Título', { exact: true }).fill('Cambio pendiente');
      await page.getByRole('link', { name: '← Proyectos', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: 'Seguir editando' }).click();
      await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Cambio pendiente');
      await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Guardado');
      await page.getByRole('link', { name: '← Proyectos', exact: true }).click();
      await page.getByRole('link', { name: /Cambio pendiente/ }).click();
    }
    await page.getByRole('button', { name: 'Archivar proyecto', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '¿Archivar este proyecto?' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirmar archivo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Proyectos', exact: true })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'No hay proyectos', exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/private-projects.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/private-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Acceso privado', exact: true })).toBeVisible();
});
