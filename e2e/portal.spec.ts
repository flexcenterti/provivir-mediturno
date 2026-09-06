import { expect, test } from '@playwright/test';
import {
  enTresDias, fijarConfig, manana, PACIENTE, proximoLunes, SIN_VENTANA, ventanaDeUnSoloDia,
} from './utiles';

/**
 * Portal público de autoagendamiento (Fase 5, RN-10).
 *
 * Es el único canal donde el paciente opera solo, sin asistente que corrija un
 * malentendido. Lo que se comprueba aquí es el camino completo hasta el código
 * de cita, y las dos puertas que protegen datos personales: la verificación de
 * identidad y el consentimiento de la Ley 1581.
 */

/*
 * RN-04.8 · Estas pruebas son anteriores a la ventana de autoagendamiento y siguen
 * probando lo suyo: el camino completo, la identidad y el consentimiento. Se apaga el
 * interruptor en vez de mover sus fechas a un día que caiga dentro de la ventana, que
 * las volvería dependientes del día en que se ejecuten. La ventana tiene su propio
 * bloque más abajo, y su propia suite de API.
 */
test.beforeAll(async ({ request }) => { await fijarConfig(request, SIN_VENTANA); });

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

  // RN-04.6 · el portal no ofrece hoy: arranca en mañana y no deja elegir antes.
  await expect(page.locator('#fecha')).toHaveValue(manana());
  await expect(page.locator('#fecha')).toHaveAttribute('min', manana());

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

test.describe('RN-04.8 · con la ventana de autoagendamiento encendida', () => {
  /*
   * Las siete filas apuntan al día de la semana que cae dentro de tres días, así que la
   * ventana es exactamente esa fecha corra el día que corra. Y la franja de citas deja
   * fuera las mañanas, que es lo único que ofrece el seed: la lista sale vacía a
   * propósito, para poder comprobar qué dice el portal cuando eso pasa.
   */
  test.beforeAll(async ({ request }) => {
    await fijarConfig(request, {
      autoagendamiento_ventana_activa: 'true',
      autoagendamiento_ventana_dias: ventanaDeUnSoloDia(enTresDias()),
      autoagendamiento_dias_excluidos: '',
      autoagendamiento_horario_cita: '12:00-23:59',
      autoagendamiento_horario_canal: '00:00-23:59',
    });
  });

  // El siguiente proyecto de Playwright hereda la base: dejarla encendida rompería
  // pruebas que no tienen nada que ver con esto.
  test.afterAll(async ({ request }) => { await fijarConfig(request, SIN_VENTANA); });

  /*
   * Mata: dejar el `min` cableado a mañana y sin `max`. Sin esto el paciente elige a
   * ciegas contra un 400, que es exactamente lo que la regla no puede permitirse.
   */
  test('el selector de fecha viene acotado a la ventana', async ({ page }) => {
    await page.goto('');
    await page.getByRole('button', { name: /Ya soy paciente/ }).click();
    await page.getByLabel('Número de documento').fill(PACIENTE.documento);
    await page.getByLabel('Últimos 4 dígitos de tu teléfono').fill(PACIENTE.ultimos4);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: /Medicina general · Consulta/ }).click();
    await page.getByRole('button', { name: /Ver horarios|Continuar/ }).click();

    const fecha = page.locator('#fecha');
    await expect(fecha).toHaveAttribute('min', enTresDias());
    await expect(fecha).toHaveAttribute('max', enTresDias());
    // Y arranca dentro, no en mañana: un valor fuera de rango no se puede ni consultar.
    await expect(fecha).toHaveValue(enTresDias());
  });

  /*
   * Mata: dejar el vacío diciendo solo «no hay horarios disponibles ese día». Los hay
   * —el seed atiende por la mañana—, pero no por este canal; el paciente se iría
   * creyendo que la agenda está llena.
   */
  test('cuando la franja deja la lista vacía, el portal dice por qué', async ({ page }) => {
    await page.goto('');
    await page.getByRole('button', { name: /Ya soy paciente/ }).click();
    await page.getByLabel('Número de documento').fill(PACIENTE.documento);
    await page.getByLabel('Últimos 4 dígitos de tu teléfono').fill(PACIENTE.ultimos4);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await page.getByRole('button', { name: /Medicina general · Consulta/ }).click();
    await page.getByRole('button', { name: /Ver horarios|Continuar/ }).click();

    await expect(page.locator('.p-cupo')).toHaveCount(0);
    await expect(page.locator('.p-cupos')).toContainText('entre las 12:00 y las 23:59');
  });
});
