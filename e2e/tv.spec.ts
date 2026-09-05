import { expect, test } from '@playwright/test';
import { ADMIN } from './utiles';

/**
 * Pantallas de sala (RN-11).
 *
 * Corren sin nadie delante, en un televisor que nadie va a reiniciar. Lo que se
 * comprueba es que un error de configuración se vea como un mensaje legible y no
 * como una pantalla en negro que nadie sabe interpretar.
 */

/** Crea una pantalla por la API y devuelve su id. */
async function crearPantalla(
  request: import('@playwright/test').APIRequestContext,
  cuerpo: Record<string, unknown>,
): Promise<string> {
  const login = await request.post('http://localhost:3000/api/auth/login', { data: ADMIN });
  const { accessToken, token } = await login.json();
  const r = await request.post('http://localhost:3000/api/pantallas', {
    headers: { Authorization: `Bearer ${accessToken ?? token}` },
    data: cuerpo,
  });
  expect(r.status(), 'no se pudo crear la pantalla de prueba').toBe(201);
  return (await r.json()).id;
}

/**
 * Una pantalla propia, creada por la API.
 *
 * Antes se tomaba la primera del seed. Dejó de servir cuando las pruebas del
 * backoffice pasaron a poder retirarlas: este proyecto corre después y se encontraba
 * la tabla vacía. Crear la suya quita esa dependencia entre proyectos.
 */
async function primeraPantalla(request: import('@playwright/test').APIRequestContext): Promise<{ id: string; nombre: string }> {
  const id = await crearPantalla(request, { nombre: 'TV · Sala de pruebas', servicios: ['mg', 'lab'] });
  return { id, nombre: 'TV · Sala de pruebas' };
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

// ─────────────── Fase 19 · el llamado suena y la pantalla no se queda en blanco ───────────────

/*
 * Mata: pintar «Esperando llamados» también sin servicios. Los dos textos son
 * indistinguibles desde la sala, y el segundo hace pensar en una mañana tranquila
 * cuando en realidad el televisor no va a mostrar nada nunca.
 */
test('una pantalla sin servicios lo dice, en vez de esperar para siempre', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Sin servicios', servicios: [] });
  await page.goto(`?pantalla=${id}`);

  await expect(page.getByText(/no tiene servicios asignados/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Esperando llamados')).toHaveCount(0);
});

/*
 * Mata: crear el `AudioContext` sin mirar `config.sonido`. La pantalla del laboratorio
 * está configurada muda a propósito y le estaría pidiendo un gesto a la sala que nadie
 * va a hacer, con una franja permanente encima del tablero.
 */
test('con el sonido apagado no se pide activar nada', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Muda', servicios: ['lab'], sonido: false });
  await page.goto(`?pantalla=${id}`);

  await expect(page.getByText('TV · Muda')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /activar el sonido/ })).toHaveCount(0);
});

/*
 * Los dos caminos de activación del sonido se prueban en proyectos distintos, porque
 * los decide el navegador. El de serie de Playwright deja el `AudioContext` suspendido
 * —para `AudioContext` el valor por defecto de Chrome es
 * `document-user-activation-required`—, así que **este archivo reproduce el stick sin
 * configurar**. El bien instalado, con `--autoplay-policy=no-user-gesture-required`,
 * está en `tv-con-flag.spec.ts`.
 */

/*
 * Mata: pintar la franja como un `<div onClick>` en vez de un `<button>` enfocado. En
 * un televisor sin táctil, el OK del mando dispara un `click` sobre el elemento CON
 * FOCO: un div no lo recibe nunca y no habría forma de activar el sonido.
 *
 * Y mata también pintarla como modal: lo que no puede pasar nunca es que la petición
 * de permiso esconda los turnos.
 */
test('sin el flag del kiosko se ofrece activar el sonido, sin tapar el tablero', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Con sonido', servicios: ['lab'], sonido: true });
  await page.goto(`?pantalla=${id}`);

  const franja = page.getByRole('button', { name: /activar el sonido/ });
  await expect(franja).toBeVisible({ timeout: 15_000 });
  await expect(franja).toBeFocused();
  await expect(page.getByText('TV · Con sonido')).toBeVisible();
  await expect(page.locator('.tv-turnos')).toBeVisible();
});

/* Mata: dejar la franja puesta tras el gesto — taparía el tablero para siempre. */
test('y al pulsarla desaparece', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Se activa', servicios: ['lab'], sonido: true });
  await page.goto(`?pantalla=${id}`);

  const franja = page.getByRole('button', { name: /activar el sonido/ });
  await expect(franja).toBeVisible({ timeout: 15_000 });
  await franja.click();
  await expect(franja).toHaveCount(0);
});

/*
 * Mata: quitar el ErrorBoundary de `main.tsx`. El modo de fallo sería una página en
 * blanco, que desde la sala es indistinguible de un televisor averiado — y no hay
 * nadie ahí para abrir la consola ni para pulsar F5. La prueba del id inexistente se
 * conforma con «el body no está vacío» y no cazaría esto.
 */
test('un error de la aplicación no deja el televisor en blanco', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Rota', servicios: ['lab'] });

  // Una respuesta con la forma equivocada revienta el render, que es justo lo que el
  // ErrorBoundary tiene que atrapar.
  await page.route(`**/api/pantallas/${id}/estado`, (ruta) =>
    ruta.fulfill({ status: 200, contentType: 'application/json', body: '{"pantalla":{},"llamados":null}' }));

  await page.goto(`?pantalla=${id}`);
  await expect(page.getByText(/se reiniciará sola/)).toBeVisible({ timeout: 15_000 });
});
