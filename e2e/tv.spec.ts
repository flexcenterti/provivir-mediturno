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


/** Un PNG de 1×1 de verdad: el servidor valida por la firma, no por la extensión. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function conSesion(request: import('@playwright/test').APIRequestContext) {
  const login = await request.post('http://localhost:3000/api/auth/login', { data: ADMIN });
  const { accessToken, token } = await login.json();
  return { Authorization: `Bearer ${accessToken ?? token}` };
}

/** Deja exactamente `cuantos` anuncios en la sede. Son compartidos: hay que limpiarlos. */
async function anuncios(request: import('@playwright/test').APIRequestContext, cuantos: number) {
  const headers = await conSesion(request);
  const previos = await (await request.get('http://localhost:3000/api/pantallas/anuncios', { headers })).json();
  for (const a of previos) {
    await request.delete(`http://localhost:3000/api/pantallas/anuncios/${a.id}`, { headers });
  }
  for (let i = 0; i < cuantos; i++) {
    const r = await request.post('http://localhost:3000/api/pantallas/anuncios', {
      headers,
      multipart: { archivo: { name: `cartel${i}.png`, mimeType: 'image/png', buffer: PNG_1x1 } },
    });
    expect(r.status(), 'no se pudo subir el anuncio de prueba').toBe(201);
  }
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

/*
 * Los anuncios son de SEDE: sin esto, cualquier prueba —o cualquier proyecto que corra
 * antes— le deja una franja a la siguiente. Cada prueba que los necesita llama a
 * `anuncios()` explícitamente.
 */

/**
 * Fija la política de audio del navegador en vez de padecerla.
 *
 * Estas pruebas existen para comprobar NUESTRA rama de interfaz —si el navegador
 * bloquea el audio, se ofrece una franja enfocada que no tapa el tablero—, no para
 * comprobar la política de Chrome, que es asunto suyo y que en este entorno no es
 * determinista: la misma prueba pasaba por la mañana y fallaba por la tarde con el
 * mismo código. Que el audio se desbloquee de verdad en un stick se verifica en la
 * sede, y así está escrito en la guía de despliegue.
 *
 * El sustituto modela lo que hace Chrome: un contexto nace suspendido y `resume()`
 * solo prospera si ha habido interacción del usuario.
 */
async function conAudioBloqueado(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    /*
     * El gesto se rastrea a mano y NO con `navigator.userActivation`: Playwright
     * reporta `hasBeenActive: true` en una página recién cargada, sin que nadie haya
     * tocado nada. Eso es justamente lo que hacía inestable a esta prueba antes —la
     * política real de Chrome mira lo mismo—, así que el doble tiene que modelar el
     * gesto de verdad.
     */
    let gesto = false;
    addEventListener('pointerdown', () => { gesto = true; }, true);

    class ContextoFalso {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      resume() {
        if (gesto) this.state = 'running';
        return Promise.resolve();
      }
      close() { this.state = 'closed'; return Promise.resolve(); }
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect: () => ({ connect: () => undefined }), start: () => undefined, stop: () => undefined };
      }
      createGain() {
        return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => ({ connect: () => undefined }) };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = ContextoFalso;
    (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = ContextoFalso;
  });
}

test.beforeEach(async ({ request }) => { await anuncios(request, 0); });

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
 * Los dos caminos de activación del sonido, con la política del navegador fijada por
 * `conAudioBloqueado` en vez de heredada. Antes esto vivía en dos proyectos de
 * Playwright con distintos argumentos de Chrome, y resultó no ser determinista: la
 * misma prueba pasaba y fallaba con el mismo código según el día.
 */

/*
 * Mata: pintar la franja como un `<div onClick>` en vez de un `<button>` enfocado. En
 * un televisor sin táctil, el OK del mando dispara un `click` sobre el elemento CON
 * FOCO: un div no lo recibe nunca y no habría forma de activar el sonido.
 *
 * Y mata también pintarla como modal: lo que no puede pasar nunca es que la petición
 * de permiso esconda los turnos.
 */
test('con el audio bloqueado se ofrece activarlo, enfocado y sin tapar el tablero', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Con sonido', servicios: ['lab'], sonido: true });
  await conAudioBloqueado(page);
  await page.goto(`?pantalla=${id}`);

  const franja = page.getByRole('button', { name: /activar el sonido/ });
  await expect(franja).toBeVisible({ timeout: 15_000 });
  await expect(franja).toBeFocused();
  await expect(page.getByText('TV · Con sonido')).toBeVisible();
  await expect(page.locator('.tv-turnos')).toBeVisible();
});

/* Mata: dejar la franja puesta tras el gesto — taparía el tablero para siempre. */
/*
 * Mata: pedir el gesto siempre, ignorando que el contexto ya quedó `running`. Un
 * televisor bien instalado —el que arranca con `--autoplay-policy=no-user-gesture-required`,
 * como manda la guía— tendría una franja permanente encima del tablero que nadie
 * necesita tocar.
 */
test('con el audio permitido el sonido se arma solo y no se pide nada', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Armada sola', servicios: ['lab'], sonido: true });
  await page.addInitScript(() => {
    class Permitido {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume() { return Promise.resolve(); }
      close() { this.state = 'closed'; return Promise.resolve(); }
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect: () => ({ connect: () => undefined }), start: () => undefined, stop: () => undefined };
      }
      createGain() {
        return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => ({ connect: () => undefined }) };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = Permitido;
  });
  await page.goto(`?pantalla=${id}`);

  await expect(page.getByText('TV · Armada sola')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /activar el sonido/ })).toHaveCount(0);
});

test('y al pulsarla desaparece', async ({ page, request }) => {
  const id = await crearPantalla(request, { nombre: 'TV · Se activa', servicios: ['lab'], sonido: true });
  await conAudioBloqueado(page);
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

// ─────────────── Fase 20 · el reparto de la guía de televisión ───────────────

/*
 * Mata: dejar el grid en `1fr 1fr`, o renderizar la franja donde no toca.
 *
 * Se compara con `boundingBox()` y no con `toHaveClass`: la clase puede estar puesta y
 * el CSS no aplicarse, que es exactamente el fallo que hay que cazar en un rediseño de
 * layout.
 */
test('con video y anuncios: la lista es más estrecha que el video, y la franja va debajo', async ({ page, request }) => {
  await anuncios(request, 2);
  const id = await crearPantalla(request, {
    nombre: 'TV · Guía', servicios: ['mg'], media: true, canalYoutube: 'aqz-KE-bpKQ',
  });
  await page.goto(`?pantalla=${id}`);

  await expect(page.locator('.tv-anuncios img')).toHaveCount(2, { timeout: 15_000 });
  const turnos = (await page.locator('.tv-turnos').boundingBox())!;
  const video = (await page.locator('.tv-media').boundingBox())!;
  const franja = (await page.locator('.tv-anuncios').boundingBox())!;

  expect(turnos.width).toBeLessThan(video.width);
  // La franja va debajo del video, no al lado.
  expect(franja.y).toBeGreaterThan(video.y);
  expect(Math.round(franja.x)).toBe(Math.round(video.x));

  await anuncios(request, 0);
});

/*
 * Mata: el defecto que existe hoy. El grid era `1fr 1fr` aunque `media` fuera false, así
 * que una pantalla sin video dejaba media pantalla en negro.
 */
test('sin video, los turnos ocupan el ancho entero', async ({ page, request }) => {
  await anuncios(request, 0);
  const id = await crearPantalla(request, { nombre: 'TV · Sin video', servicios: ['mg'] });
  await page.goto(`?pantalla=${id}`);

  await expect(page.getByText('TV · Sin video')).toBeVisible({ timeout: 15_000 });
  const cuerpo = (await page.locator('.tv-cuerpo').boundingBox())!;
  const turnos = (await page.locator('.tv-turnos').boundingBox())!;
  expect(turnos.width / cuerpo.width).toBeGreaterThan(0.8);
  await expect(page.locator('.tv-media')).toHaveCount(0);
});

/*
 * Mata: renderizar el contenedor de la franja siempre. Sin anuncios quedaría una banda
 * negra de 160 px bajo el video que en la pared parece una avería del televisor.
 */
test('sin anuncios, la franja no existe en el DOM', async ({ page, request }) => {
  await anuncios(request, 0);
  const id = await crearPantalla(request, {
    nombre: 'TV · Sin franja', servicios: ['mg'], media: true, canalYoutube: 'aqz-KE-bpKQ',
  });
  await page.goto(`?pantalla=${id}`);

  await expect(page.locator('.tv-media')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tv-anuncios')).toHaveCount(0);
});

/*
 * Mata: dejar `min-height: 100vh` en `.tv`. Un televisor no tiene barra de
 * desplazamiento, así que lo que desborda no se ve y nadie lo descubre. A 1366×768,
 * que es la resolución de la mayoría de los sticks, nada puede quedar por debajo del
 * borde.
 */
test('a 1366×768 no queda nada fuera de la pantalla', async ({ page, request }) => {
  await anuncios(request, 2);
  await page.setViewportSize({ width: 1366, height: 768 });
  const id = await crearPantalla(request, {
    nombre: 'TV · Estrecha', servicios: ['mg'], media: true, turnosVisibles: 6,
    canalYoutube: 'aqz-KE-bpKQ', mensaje: 'Gracias por su visita',
  });
  await page.goto(`?pantalla=${id}`);
  await expect(page.locator('.tv-anuncios')).toBeVisible({ timeout: 15_000 });

  const alto = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(alto).toBeLessThanOrEqual(768);

  await anuncios(request, 0);
});

/*
 * Mata: quitar el `onError`. Un icono de imagen rota colgado permanentemente en la
 * pared es peor que un anuncio menos.
 */
test('un anuncio que no carga desaparece de la franja', async ({ page, request }) => {
  await anuncios(request, 2);
  const id = await crearPantalla(request, { nombre: 'TV · Rota', servicios: ['mg'] });
  await page.route('**/api/pantallas/anuncios/*/imagen', (r) => r.fulfill({ status: 404 }));

  await page.goto(`?pantalla=${id}`);
  await expect(page.getByText('TV · Rota')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tv-anuncios')).toHaveCount(0);

  await page.unroute('**/api/pantallas/anuncios/*/imagen');
  await anuncios(request, 0);
});

test.describe('el reloj', () => {
  /*
   * El navegador se pone en Madrid a propósito: con el runner en Bogotá, cualquier
   * implementación pasaría. Es la única forma de matar la mutación.
   */
  test.use({ timezoneId: 'Europe/Madrid' });

  /*
   * Mata: formatear sin `timeZone`, o leer la hora del aparato en vez de la del
   * servidor. Los sticks HDMI baratos arrancan con la zona horaria mal, y un reloj
   * equivocado colgado en la pared de una sala de espera es peor que no tener ninguno.
   */
  test('muestra la hora de Bogotá aunque el aparato esté en otra zona', async ({ page, request }) => {
    const id = await crearPantalla(request, { nombre: 'TV · Reloj', servicios: ['mg'] });
    await page.goto(`?pantalla=${id}`);

    const reloj = page.locator('.tv-reloj strong');
    await expect(reloj).toBeVisible({ timeout: 15_000 });

    const enBogota = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit',
    }).format(new Date());
    // Solo la hora: el minuto puede cambiar entre la petición y la aserción.
    expect((await reloj.innerText()).slice(0, 2)).toBe(enBogota.slice(0, 2));
  });
});
