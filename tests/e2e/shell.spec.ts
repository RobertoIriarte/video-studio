import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('proyectos: filtros en URL, recuperación de vacío y apertura', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Proyectos.', exact: true })).toBeVisible();
  await expect(page.locator('.project-card')).toHaveCount(4);
  await page.getByRole('searchbox', { name: 'Buscar proyectos' }).fill('océanos');
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('searchbox')).toHaveValue('océanos');
  await page.getByRole('searchbox').fill('inexistente');
  await expect(page.getByRole('heading', { name: 'No hay proyectos con estos filtros' })).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByLabel('Filtrar por estado').selectOption('En revisión');
  await expect(page.locator('.project-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Abrir La memoria del bosque' })).toBeVisible();
  await page.getByLabel('Filtrar por estado').selectOption('Todos');
  await page.getByLabel('Ordenar proyectos').selectOption('name');
  await expect(page.locator('.project-card').first()).toHaveAttribute('href', '/projects/ciudad');
  await page.getByRole('link', { name: 'Abrir El silencio de los océanos' }).click();
  await expect(page.getByRole('heading', { name: 'El silencio de los océanos', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar producción' })).toBeDisabled();
});

const routes = [
  ['/login', 'Acceso privado'], ['/projects/new', 'Nuevo proyecto.'],
  ['/library', 'Biblioteca.'], ['/generations', 'Generaciones.'],
  ['/providers', 'Proveedores.'], ['/settings', 'Configuración.'],
  ...['research', 'script', 'direction', 'scenes', 'voice', 'assets', 'edit', 'qa', 'render', 'youtube'].map((path) => [`/projects/oceanos/${path}`, 'El silencio de los océanos']),
  ['/projects/oceanos/scenes/escena-1', 'Escena 01 · Un mundo por descubrir'],
];
for (const [path, heading] of routes) {
  test(`ruta directa y recarga: ${path}`, async ({ page }) => {
    await page.goto(path ?? '/projects');
    await expect(page.getByRole('heading', { name: heading ?? '', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: heading ?? '', exact: true })).toBeVisible();
  });
}

test('24 escenas paginadas, navegación de detalle y vuelta atrás', async ({ page }) => {
  await page.goto('/projects/oceanos/scenes');
  await expect(page.locator('.scene-list li')).toHaveCount(6);
  await expect(page.getByText('Página 1 de 4', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(page.locator('.scene-number').first()).toHaveText('07');
  await page.reload();
  await expect(page.getByText('Página 2 de 4', { exact: true })).toBeVisible();
  await page.locator('.scene-list a').first().click();
  await expect(page.getByRole('heading', { name: 'Escena 07 · Un mundo por descubrir' })).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Página 2 de 4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(page.locator('.scene-number').last()).toHaveText('24');
  await expect(page.getByRole('button', { name: 'Página siguiente' })).toBeDisabled();
});

test('estados transversales y reintento conservan filtros', async ({ page }) => {
  await page.goto('/projects?q=océanos');
  await page.getByLabel('Estado de vista').selectOption('loading');
  await expect(page.getByRole('status', { name: 'Cargando contenido' })).toHaveAttribute('aria-busy', 'true');
  await page.getByLabel('Estado de vista').selectOption('empty');
  await expect(page.getByRole('heading', { name: 'Todavía no hay contenido' })).toBeVisible();
  await page.getByLabel('Estado de vista').selectOption('denied');
  await expect(page.getByRole('heading', { name: 'Acceso no disponible' })).toBeVisible();
  await page.getByLabel('Estado de vista').selectOption('notfound');
  await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
  await page.getByLabel('Estado de vista').selectOption('error');
  await expect(page.getByRole('alert')).toContainText('DEMO_LOAD_ERROR');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('océanos');
  await expect(page.locator('.project-card')).toHaveCount(1);
});

test('sidebar por teclado, colapso y foco de ruta', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Plegar navegación' }).click();
  await expect(page.getByRole('button', { name: 'Expandir navegación' })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'Biblioteca', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('link', { name: 'Proveedores', exact: true }).focus();
  await expect(page.getByRole('tooltip', { name: 'Proveedores' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip', { name: 'Proveedores' })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Configuración', exact: true })).toBeFocused();
  await expect(page.getByRole('link', { name: 'Configuración', exact: true })).toHaveCSS('outline-style', 'solid');
  await page.getByRole('link', { name: 'Biblioteca', exact: true }).hover();
  const tooltip = page.getByRole('tooltip', { name: 'Biblioteca', exact: true });
  const bounds = await tooltip.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds) await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 12 });
  await expect(tooltip).toBeVisible();
});

test('desconexión y reconexión sin perder la vista', async ({ page, context }) => {
  await page.goto('/projects');
  await context.setOffline(true);
  await expect(page.getByRole('alert')).toContainText('Sin conexión');
  await expect(page.locator('.project-card')).toHaveCount(4);
  await context.setOffline(false);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.project-card')).toHaveCount(4);
});

test('rutas, proyectos y escenas inexistentes muestran 404', async ({ page }) => {
  for (const path of ['/desconocido', '/projects/no-existe', '/projects/oceanos/scenes/no-existe']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
    await page.getByRole('link', { name: 'Volver a proyectos' }).click();
    await expect(page).toHaveURL(/\/projects$/);
  }
});

test('revisión visual y accesibilidad AA de escritorio y móvil', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/projects');
  await expect(page.locator('.project-card')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('proyectos-desktop.png'), fullPage: true });
  const desktop = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(desktop.violations).toEqual([]);
  await page.goto('/projects/oceanos/scenes');
  await page.screenshot({ path: testInfo.outputPath('escenas-desktop.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projects');
  await expect(page.getByRole('link', { name: 'Biblioteca', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('proyectos-mobile.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});
