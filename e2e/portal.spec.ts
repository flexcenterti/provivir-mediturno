import { expect, test } from '@playwright/test';
import { PACIENTE, proximoLunes } from './utiles';

/**
 * Portal público de autoagendamiento (Fase 5, RN-10).
 *
 * Es el único canal donde el paciente opera solo, sin asistente que corrija un
 * malentendido. Lo que se comprueba aquí es el camino completo hasta el código
 * de cita, y las dos puertas que protegen datos personales: la verificación de
 * identidad y el consentimiento de la Ley 1581.
 */

test('la portada ofrece los dos caminos y no pide datos todavía', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { name: 'Agenda tu cita' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Ya soy paciente/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Soy paciente nuevo/ })).toBeVisible();
  // Nada de formularios antes de que el paciente elija: RN-10 pide fricción mínima.
  await expect(page.locator('input')).toHaveCount(0);
});

test('un paciente registrado agenda de principio a fin', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Ya soy paciente/ }).click();

  await page.getByLabel('Número de documento').fill(PACIENTE.documento);
  await page.getByLabel('Últimos 4 dígitos de tu teléfono').fill(PACIENTE.ultimos4);
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Saluda por el nombre: confirma que la sesión quedó atada al paciente correcto.
  await expect(page.getByRole('heading', { name: new RegExp(`Hola, ${PACIENTE.nombre}`) })).toBeVisible();

  await page.getByRole('button', { name: /Medicina general · Consulta/ }).click();
  await page.getByRole('button', { name: /Ver horarios|Continuar/ }).click();

  // Una fecha con agenda de verdad: el seed atiende medicina general de lunes a sábado.
  await page.locator('#fecha').fill(proximoLunes());

  const cupos = page.locator('.p-cupo:not([disabled])');
  await expect(cupos.first()).toBeVisible({ timeout: 15_000 });
  const horaElegida = (await cupos.first().innerText()).trim();
  await cupos.first().click();

  await expect(page.getByRole('heading', { name: /Tu cita quedó agendada/ })).toBeVisible({ timeout: 15_000 });

  // El código es lo que el paciente presenta en el mostrador: si falta, no sirve de nada.
  await expect(page.getByText(/[A-Z]+-?\d+/).first()).toBeVisible();
  await expect(page.locator('.p-confirmada')).toContainText(horaElegida.split('\n')[0]!);
});

test('los últimos 4 dígitos equivocados no dejan entrar', async ({ page }) => {
  // RN-10.2 · sin esto bastaría un documento para saber quién es paciente de la clínica.
  await page.goto('');
  await page.getByRole('button', { name: /Ya soy paciente/ }).click();
  await page.getByLabel('Número de documento').fill(PACIENTE.documento);
  await page.getByLabel('Últimos 4 dígitos de tu teléfono').fill('0000');
  await page.getByRole('button', { name: 'Continuar' }).click();

  await expect(page.getByRole('heading', { name: /Hola,/ })).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeVisible();
});

test('un documento inexistente no revela si está o no registrado', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Ya soy paciente/ }).click();
  await page.getByLabel('Número de documento').fill('99999999');
  await page.getByLabel('Últimos 4 dígitos de tu teléfono').fill('1111');
  await page.getByRole('button', { name: 'Continuar' }).click();

  const mensaje = page.getByRole('alert');
  await expect(mensaje).toBeVisible();
  // No debe decir "no existe" ni "no está registrado": eso es enumeración.
  await expect(mensaje).not.toContainText(/no (existe|está registrad)/i);
});

test('registrarse exige el consentimiento de datos antes de enviar', async ({ page }) => {
  // Ley 1581/2012 · el consentimiento es previo y explícito, no una casilla premarcada.
  await page.goto('');
  await page.getByRole('button', { name: /Soy paciente nuevo/ }).click();

  await page.getByLabel('Número de documento').fill('88887777');
  await page.getByLabel('Nombres').fill('Prueba');
  await page.getByLabel('Apellidos').fill('Automatizada');
  await page.getByLabel('Teléfono / WhatsApp').fill('+57 300 999 8888');

  const enviar = page.getByRole('button', { name: 'Continuar' });
  await expect(enviar).toBeDisabled();

  const casilla = page.getByRole('checkbox');
  await expect(casilla).not.toBeChecked();
  await casilla.check();
  await expect(enviar).toBeEnabled();
});

test('el aviso de privacidad está a la vista y nombra la ley', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: /Aviso de privacidad/ }).click();
  await expect(page.getByText(/Ley 1581/)).toBeVisible();
  // RN-12.4 · la plataforma no guarda datos clínicos, y el aviso debe decirlo.
  await expect(page.getByText(/no se almacenan datos clínicos/i)).toBeVisible();
});
