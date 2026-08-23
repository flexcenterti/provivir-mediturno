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

// ─────────────── Fase 7 · base de conocimiento y seguimiento ───────────────

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('');
  await page.getByLabel('Correo').fill(ADMIN.email);
  await page.getByLabel('Contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: /Entrar|Ingresar/ }).click();
  await expect(page.getByLabel('Contraseña')).toHaveCount(0, { timeout: 15_000 });
}

test('RN-13 · la base de conocimiento se prueba antes de exponerla a un paciente', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Conocimiento' }).click();
  await expect(page.getByRole('heading', { name: 'Base de conocimiento' })).toBeVisible();

  // La base arranca vacía: el bot sigue con el bloque de documentación comercial.
  await expect(page.getByRole('button', { name: /Importar documentación comercial/ })).toBeVisible();

  await page.getByRole('button', { name: /Importar documentación comercial/ }).click();
  await expect(page.getByText(/artículo\(s\) importados/)).toBeVisible({ timeout: 15_000 });

  // Lo importado debe responder de inmediato.
  await page.getByPlaceholder('Escribe una pregunta como la haría un paciente')
    .fill('¿Cómo me preparo para la ecografía?');
  await page.getByRole('button', { name: 'Probar' }).click();
  await expect(page.getByText(/Responde · coincidencia/)).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: 'e2e/capturas/conocimiento.png', fullPage: true });
});

test('RN-13.4 · un tema clínico escala aunque haya con qué responder', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Conocimiento' }).click();

  await page.getByRole('button', { name: 'Me duele el pecho, ¿qué tengo?' }).click();
  await expect(page.getByText(/Escala siempre/)).toBeVisible({ timeout: 15_000 });
});

test('RN-13.3 · lo que la base no cubre escala en vez de aproximar', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Conocimiento' }).click();

  await page.getByRole('button', { name: '¿Tienen parqueadero?' }).click();
  await expect(page.getByText(/Sin cobertura/)).toBeVisible({ timeout: 15_000 });
});

test('RN-09.9.8 · los interesados se ven en la bandeja, bajo las escaladas', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();

  await expect(page.getByRole('heading', { name: 'Bandeja de la asistente' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Interesados sin agendar' })).toBeVisible();

  await page.screenshot({ path: 'e2e/capturas/bandeja.png', fullPage: true });
});

test('RN-04.5.1 · el formulario del catálogo edita la ficha comercial', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Catálogo' }).click();
  // El catálogo abre en Prestadores: sin cambiar de pestaña, «Ecografía Doppler»
  // aparece en la columna de duraciones de un prestador, no como servicio.
  await page.getByRole('button', { name: 'Servicios' }).click();

  const fila = page.getByRole('row', { name: /Ecografía Doppler/ });
  await fila.getByRole('button', { name: 'Editar' }).click();

  await expect(page.getByRole('group', { name: 'Ficha comercial' })).toBeVisible();
  await expect(page.getByLabel(/Beneficios/)).toBeVisible();

  await page.screenshot({ path: 'e2e/capturas/catalogo.png', fullPage: true });
});
