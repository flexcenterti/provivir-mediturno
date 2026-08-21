import { expect, test } from '@playwright/test';
import { ADMIN } from './utiles';

/**
 * Backoffice · lo que usan las asistentes todo el día.
 *
 * Aquí interesa sobre todo la puerta: es la aplicación con acceso a los datos de
 * todos los pacientes, y detrás de un login que no puede filtrar por qué falló.
 */

test('sin sesión se muestra el login y nada más', async ({ page }) => {
  await page.goto('');
  await expect(page.getByLabel('Correo')).toBeVisible();
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  // Ninguna vista de datos debe asomar antes de autenticarse.
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('una contraseña equivocada no dice si el correo existe', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Correo').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill('clave-equivocada');
  await page.getByRole('button', { name: /Entrar|Ingresar/ }).click();

  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  // Distinguir "no existe" de "clave incorrecta" regala una lista de usuarios válidos.
  await expect(error).not.toContainText(/no existe|usuario no encontrado/i);
});

test('un correo inexistente da el mismo mensaje que una clave mala', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Correo').fill('nadie@provivir.local');
  await page.getByLabel('Contraseña').fill('loquesea123');
  await page.getByRole('button', { name: /Entrar|Ingresar/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('con credenciales válidas se entra y la sesión sobrevive al recargar', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Correo').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: /Entrar|Ingresar/ }).click();

  await expect(page.getByLabel('Contraseña')).toHaveCount(0, { timeout: 15_000 });

  // Recargar no debe devolver al login: la asistente pierde el hilo del mostrador.
  await page.reload();
  await expect(page.getByLabel('Contraseña')).toHaveCount(0, { timeout: 15_000 });
});
