import { expect, test } from '@playwright/test';
import { ADMIN } from './utiles';

/**
 * El televisor CON el flag del kiosko, es decir bien instalado.
 *
 * Va en su propio archivo y su propio proyecto porque cambiar los argumentos del
 * navegador obliga a un worker distinto, y Playwright no lo permite dentro de un
 * `describe`. La separación además dice la verdad: son dos situaciones de hardware.
 *
 * **El navegador de serie de Playwright NO es el televisor configurado, es el otro.**
 * Para `AudioContext` el valor por defecto de Chrome es
 * `document-user-activation-required`, así que el contexto arranca suspendido y la
 * franja aparece — que es justo lo que prueba `tv.spec.ts`. Pasar
 * `--autoplay-policy=user-gesture-required` **afloja** la política en vez de
 * endurecerla, porque esa variante gobierna los elementos de medios y no el
 * `AudioContext`. El flag que corresponde al stick bien instalado, y el que documenta
 * la guía de despliegue, es `no-user-gesture-required`.
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

/*
 * Mata: pedir el gesto siempre, ignorando que el contexto ya quedó `running`. Un
 * televisor bien instalado tendría una franja permanente encima del tablero que nadie
 * necesita tocar nunca.
 */
test('con el flag del kiosko el sonido se arma solo y no se pide nada', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Armada sola', servicios: ['lab'], sonido: true });
  await page.goto(`?pantalla=${id}`);

  await expect(page.getByText('TV · Armada sola')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /activar el sonido/ })).toHaveCount(0);
});
