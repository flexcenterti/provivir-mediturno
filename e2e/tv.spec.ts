import { expect, test } from '@playwright/test';
import { ADMIN } from './utiles';

/**
 * Pantallas de sala (RN-11).
 *
 * Corren sin nadie delante, en un televisor que nadie va a reiniciar. Lo que se
 * comprueba es que un error de configuración se vea como un mensaje legible y no
 * como una pantalla en negro que nadie sabe interpretar.
 */

/** El id lo genera el seed, así que se pregunta a la API en vez de fijarlo. */
async function primeraPantalla(request: import('@playwright/test').APIRequestContext): Promise<{ id: string; nombre: string }> {
  const login = await request.post('http://localhost:3000/api/auth/login', { data: ADMIN });
  expect(login.ok(), 'no se pudo autenticar para listar las pantallas').toBeTruthy();
  const { accessToken, token } = await login.json();

  const r = await request.get('http://localhost:3000/api/pantallas', {
    headers: { Authorization: `Bearer ${accessToken ?? token}` },
  });
  expect(r.ok(), 'no se pudo listar las pantallas').toBeTruthy();
  const pantallas = await r.json();
  expect(pantallas.length, 'el seed debería crear pantallas').toBeGreaterThan(0);
  return pantallas[0];
}

test('sin el parámetro de pantalla explica qué falta', async ({ page }) => {
  await page.goto('');
  // Un televisor mal configurado tiene que decirlo, no quedarse en blanco.
  await expect(page.getByText(/Falta el parámetro/)).toBeVisible();
});

test('con un id válido muestra la pantalla configurada', async ({ page, request }) => {
  const pantalla = await primeraPantalla(request);
  await page.goto(`?pantalla=${pantalla.id}`);

  await expect(page.getByText(/Falta el parámetro/)).toHaveCount(0);
  await expect(page.locator('body')).toContainText(/Provivir|turno|Consultorio|cita/i, { timeout: 15_000 });
});

test('un id inexistente no deja la pantalla en negro', async ({ page }) => {
  await page.goto('?pantalla=no-existe-esta-pantalla');
  const cuerpo = page.locator('body');
  await expect(cuerpo).not.toHaveText('', { timeout: 15_000 });
});
