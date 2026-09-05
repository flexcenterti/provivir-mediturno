import { expect, test } from '@playwright/test';
import { ADMIN, ASISTENTE, MEDICO, PACIENTE } from './utiles';

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
  /*
   * Y tiene que decir que la CREDENCIAL está mal. El frontend convertía todo 401 en
   * «Sesión expirada», así que una contraseña equivocada se leía como una cuenta
   * bloqueada — y no existe tal cosa: se pierde el rato buscando un bloqueo que
   * nadie puede levantar. Esta prueba pasaba igual, porque ese texto tampoco
   * delataba si el correo existe.
   */
  await expect(error).not.toContainText(/sesión expirada/i);
  await expect(error).toContainText(/credenciales/i);
});

test('un correo inexistente da el mismo mensaje que una clave mala', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Correo').fill('nadie@provivir.local');
  await page.getByLabel('Contraseña').fill('loquesea123');
  await page.getByRole('button', { name: /Entrar|Ingresar/ }).click();

  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  await expect(error).toContainText(/credenciales/i);
  await expect(error).not.toContainText(/sesión expirada/i);
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
  await page.getByRole('button', { name: 'Base de conocimiento' }).click();
  await expect(page.getByRole('heading', { name: /Base de conocimiento/ })).toBeVisible();

  // La base arranca vacía: el bot sigue con el bloque de documentación comercial,
  // y la migración vive dentro del panel de importación.
  await page.getByRole('button', { name: /Importar documento/ }).click();
  await page.getByRole('button', { name: /Importar documentación comercial de Reglas/ }).click();
  await expect(page.getByText(/artículo\(s\) importados/)).toBeVisible({ timeout: 15_000 });

  // Lo importado debe responder de inmediato.
  await page.getByLabel('Pregunta para probar').fill('¿Cómo me preparo para la ecografía?');
  await page.getByRole('button', { name: 'Probar ➤' }).click();
  await expect(page.getByText(/Responde con/)).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: 'e2e/capturas/conocimiento.png', fullPage: true });
});

test('RN-13.4 · un tema clínico escala aunque haya con qué responder', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Base de conocimiento' }).click();

  await page.getByRole('button', { name: 'tema prohibido' }).click();
  await expect(page.getByText(/Tema de escalamiento obligatorio/)).toBeVisible({ timeout: 15_000 });
});

test('RN-13.3 · lo que la base no cubre escala en vez de aproximar', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Base de conocimiento' }).click();

  await page.getByRole('button', { name: 'sin cobertura' }).click();
  await expect(page.locator('.conversacion-simulada').getByText(/Sin cobertura/))
    .toBeVisible({ timeout: 15_000 });
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
  // «Catálogo» se partió en dos entradas de menú; esta abre ya en la pestaña de
  // servicios. Sin ella, «Ecografía Doppler» aparecería en la columna de duraciones
  // de un prestador y no como servicio.
  await page.getByRole('button', { name: 'Servicios y exámenes' }).click();

  const fila = page.getByRole('row', { name: /Ecografía Doppler/ });
  await fila.getByRole('button', { name: 'Editar' }).click();

  await expect(page.getByRole('group', { name: 'Ficha comercial' })).toBeVisible();
  await expect(page.getByLabel(/Beneficios/)).toBeVisible();

  await page.screenshot({ path: 'e2e/capturas/catalogo.png', fullPage: true });
});

test('RN-13.5.4 · borrar un artículo publicado explica por qué y ofrece archivar', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Base de conocimiento' }).click();

  // Se crea y publica el artículo aquí en vez de reutilizar el de otra prueba:
  // depender del orden de ejecución hace que el fallo aparezca donde no está.
  const titulo = 'Política de cancelación con 4 horas';
  await page.getByRole('button', { name: '➕ Crear' }).click();
  await page.getByLabel('Título').fill(titulo);
  await page.getByLabel('Categoría').fill('Políticas');
  await page.getByLabel('Contenido').fill('Puedes cancelar o reprogramar hasta 4 horas antes de tu cita.');
  await page.getByRole('button', { name: 'Crear borrador' }).click();
  await expect(page.getByText(/creado como borrador/)).toBeVisible({ timeout: 15_000 });

  const fila = page.getByRole('row').filter({ hasText: titulo });
  await fila.getByRole('button', { name: 'Publicar' }).click();
  await expect(page.getByText(/publicado\./)).toBeVisible({ timeout: 15_000 });
  await fila.getByRole('button', { name: '🗑' }).click();

  await expect(page.getByRole('heading', { name: /No se puede eliminar/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archivar en su lugar' })).toBeVisible();
});

test('RN-13.7.1 · un borrador nuevo no lo recupera el bot hasta publicarlo', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Base de conocimiento' }).click();

  await page.getByRole('button', { name: '➕ Crear' }).click();
  await page.getByLabel('Título').fill('Parqueadero para pacientes');
  await page.getByLabel('Categoría').fill('Información general');
  await page.getByLabel('Contenido').fill('La sede cuenta con parqueadero gratuito para pacientes.');
  await page.getByRole('button', { name: 'Crear borrador' }).click();

  await expect(page.getByText(/creado como borrador/)).toBeVisible({ timeout: 15_000 });

  // Existe, pero en borrador: el probador tiene que seguir escalando.
  await page.getByRole('button', { name: 'sin cobertura' }).click();
  await expect(page.locator('.conversacion-simulada').getByText(/Sin cobertura/))
    .toBeVisible({ timeout: 15_000 });
});

// ─────────────── Fase 10 · menú del prototipo y pantallas nuevas ───────────────

test('RN-09 · el menú agrupa las entradas en Operación, Gestión y Configuración', async ({ page }) => {
  await entrar(page);

  const menu = page.getByRole('navigation');
  await expect(menu.getByText('Operación', { exact: true })).toBeVisible();
  await expect(menu.getByText('Gestión', { exact: true })).toBeVisible();
  await expect(menu.getByText('Configuración', { exact: true })).toBeVisible();

  // Los iconos son decorativos: el nombre accesible sigue siendo la etiqueta sola.
  await expect(page.getByRole('button', { name: 'Base de conocimiento' })).toBeVisible();

  await page.screenshot({ path: 'e2e/capturas/menu.png', fullPage: true });
});

test('RN-09 · con perfil Asistente el menú oculta lo que su perfil no permite', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Correo').fill(ASISTENTE.email);
  await page.getByLabel('Contraseña').fill(ASISTENTE.password);
  await page.getByRole('button', { name: /Entrar|Ingresar/ }).click();
  await expect(page.getByLabel('Contraseña')).toHaveCount(0, { timeout: 15_000 });

  const menu = page.getByRole('navigation');
  // Lo que su perfil sí concede.
  await expect(menu.getByRole('button', { name: 'Métricas' })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Bandeja asistente' })).toBeVisible();
  // Lo que no: antes se decidía por rol y estos perfiles no se podían distinguir.
  await expect(menu.getByRole('button', { name: 'Auditoría' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Carga masiva' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Reglas de prioridad' })).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Administración' })).toHaveCount(0);
});

test('RN-09 · al recargar la pestaña el nombre del usuario sigue en pantalla', async ({ page }) => {
  await entrar(page);
  // `GET /auth/yo` no devolvía nombre ni correo, así que tras un F5 la píldora
  // quedaba vacía mientras la sesión seguía viva.
  await page.reload();
  await expect(page.locator('.user-pill .nm')).not.toBeEmpty({ timeout: 15_000 });
});

test('RN-02 · la pantalla de métricas separa el balanceo de medicina general', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Métricas' }).click();

  await expect(page.getByRole('heading', { name: 'Balanceo · Medicina general' })).toBeVisible();
  await expect(page.getByText(/los controles no cuentan \(RN-02\)/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Resolución automática IA' })).toHaveCount(0);

  await page.screenshot({ path: 'e2e/capturas/metricas.png', fullPage: true });
});

test('RN-10.1 · la pantalla de autoagendamiento muestra el QR de la sede', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Autoagendamiento web' }).click();

  const qr = page.getByRole('img', { name: /Código QR del portal/ });
  await expect(qr).toBeVisible();
  // Que se vea el `img` no basta: una imagen rota también «se ve».
  await expect.poll(() => qr.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  await page.screenshot({ path: 'e2e/capturas/portal-web.png', fullPage: true });
});

test('RN-05 · las reglas de prioridad se editan y quedan guardadas', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Reglas de prioridad' }).click();

  const campo = page.getByRole('spinbutton', { name: /Margen de tolerancia/ });
  const original = await campo.inputValue();

  await campo.fill('12');
  await page.getByRole('button', { name: /Guardar · Margen de tolerancia/ }).click();
  await expect(page.getByText(/Regla actualizada/)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByRole('button', { name: 'Reglas de prioridad' }).click();
  await expect(page.getByRole('spinbutton', { name: /Margen de tolerancia/ })).toHaveValue('12');

  // Se devuelve para no dejar la base de pruebas con un valor distinto del seed.
  await page.getByRole('spinbutton', { name: /Margen de tolerancia/ }).fill(original);
  await page.getByRole('button', { name: /Guardar · Margen de tolerancia/ }).click();
  await expect(page.getByText(/Regla actualizada/)).toBeVisible({ timeout: 15_000 });
});

test('la bandeja separa pendientes de cerradas y deja filtrar las propias', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();

  // Una conversación resuelta desaparecía para siempre: no había dónde buscarla.
  await expect(page.getByRole('button', { name: 'Pendientes', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerradas', exact: true }).click();
  await expect(page.getByText(/Se pueden reabrir para seguir atendiéndolas/)).toBeVisible();

  // El histórico añade rango de fechas; los pendientes no lo necesitan.
  await expect(page.getByLabel(/Desde/)).toBeVisible();

  // Con varias asistentes trabajando a la vez, saber cuáles son las tuyas.
  await expect(page.getByText('Solo las mías')).toBeVisible();

  // La tercera vista: un hilo que el bot resolvió solo no está ni en pendientes
  // (pide `escalada` o `reabiertaTs`) ni en cerradas (pide `resueltaTs`, que solo
  // escribe una persona). Sin esta pestaña no había forma de llegar a él.
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await expect(page.getByText(/las que el bot resolvió solo/)).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Situación' })).toBeVisible();
  // Buscar un paciente concreto es para lo que sirve, así que el rango también.
  await expect(page.getByLabel(/Desde/)).toBeVisible();

  await page.getByRole('button', { name: 'Pendientes', exact: true }).click();
  await expect(page.getByLabel(/Desde/)).toHaveCount(0);
});

test('§2.10 · el mostrador busca antes de registrar, en vez de adivinar', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Mostrador' }).click();

  // El campo ya no es "código o documento": también nombre y teléfono.
  const campo = page.getByPlaceholder(/Código, documento, nombre o teléfono/);
  await expect(campo).toBeVisible();

  await campo.fill('ab');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText(/al menos 3 caracteres/)).toBeVisible();

  // Sin resultados dice qué hacer, en vez de un 404 que no se puede interpretar.
  await campo.fill('Zzyzx');
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(page.getByText(/Si viene sin cita, créasela en Agenda consolidada/)).toBeVisible();
});

/**
 * RN-06.2 · la misma entrada de menú sirve a dos oficios, y no puede llamarse igual
 * en los dos. Lo que decide cuál se abre es si la cuenta tiene ficha de prestador.
 */
test('con ficha de prestador la entrada es «Mi consulta» y se puede llamar', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Correo').fill(MEDICO.email);
  await page.getByLabel('Contraseña').fill(MEDICO.password);
  await page.getByRole('button', { name: /Entrar|Ingresar/ }).click();
  await expect(page.getByLabel('Contraseña')).toHaveCount(0, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Mi consulta' }).click();
  // La no-regresión que importa: el médico sigue viendo su cola y su botón.
  await expect(page.getByRole('button', { name: 'Llamar al siguiente' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pacientes del día' })).toBeVisible();
});

test('sin ficha, la misma entrada es «Sala de espera» y no ofrece llamar a ciegas', async ({ page }) => {
  await page.goto('');
  await page.getByLabel('Correo').fill(ASISTENTE.email);
  await page.getByLabel('Contraseña').fill(ASISTENTE.password);
  await page.getByRole('button', { name: /Entrar|Ingresar/ }).click();
  await expect(page.getByLabel('Contraseña')).toHaveCount(0, { timeout: 15_000 });

  // Antes aquí solo salía «Este usuario no está asociado a una ficha de prestador».
  await expect(page.getByRole('button', { name: 'Mi consulta' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sala de espera' }).click();

  await expect(page.getByRole('heading', { name: 'En sala ahora' })).toBeVisible();
  await expect(page.getByText(/no está asociado a una ficha/)).toHaveCount(0);
  /*
   * Sin botón de llamar mientras se ve toda la sala: el llamado es siempre al
   * siguiente de la cola de UN profesional, y el motor exige decir cuál.
   */
  await expect(page.getByRole('button', { name: 'Llamar al siguiente' })).toHaveCount(0);
  await expect(page.getByText(/elija un profesional para llamar/i).first()).toBeVisible();
});

test('RN-06.2 · la ficha del médico se elige de una lista y se puede corregir después', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Administración' }).click();
  await page.getByRole('button', { name: 'Perfiles y usuarios' }).click();
  await page.getByRole('button', { name: '2 · Usuarios' }).click();

  // El vínculo se ve en la lista: es lo que decide si esa persona tiene cola.
  await expect(page.getByText(/🩺/).first()).toBeVisible();

  await page.getByRole('row', { name: /osorio@provivir\.local/ })
    .getByRole('button', { name: 'Editar' }).click();

  // Desplegable, no texto libre: antes había que teclear el id interno.
  const ficha = page.getByLabel('Ficha de prestador');
  await expect(ficha).toBeVisible();
  await expect(ficha).toHaveJSProperty('tagName', 'SELECT');
});

/**
 * RN-07.6 · La constancia del cobro en el mostrador.
 *
 * El principio que estas pruebas protegen es que **siga siendo un clic**: el
 * desenlace viene marcado según la política del servicio y la fricción aparece solo
 * en la excepción.
 */
test('§2.10 · el mostrador deja constancia del cobro sin volverse un formulario', async ({ page }) => {
  await entrar(page);

  /*
   * La cita se crea por API y no por la interfaz: el seed no trae citas de hoy, y
   * montarla clicando por Agenda consolidada haría esta prueba larga y frágil sin
   * cubrir nada más. Lo que se prueba aquí es la fila del mostrador.
   */
  const token = await page.evaluate(() => sessionStorage.getItem('accessToken'));
  const cabeceras = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const pacientes = await (await page.request.get(
    `/api/pacientes?q=${PACIENTE.documento}`, { headers: cabeceras })).json();
  const pacienteId = pacientes.datos[0].id;

  const cupos = await (await page.request.get(
    `/api/cupos?servicioId=mg&fecha=${hoy}&limite=1`, { headers: cabeceras })).json();
  test.skip(cupos.length === 0, 'Hoy no hay agenda de medicina general (domingo o festivo)');

  const creada = await (await page.request.post('/api/citas', {
    headers: cabeceras,
    data: {
      pacienteId, servicioId: 'mg', fecha: hoy, hora: cupos[0].hora,
      prestadorId: cupos[0].prestadorId, origen: 'mostrador',
    },
  })).json();

  await page.getByRole('button', { name: 'Mostrador' }).click();
  await page.getByPlaceholder(/Código, documento, nombre o teléfono/).fill(PACIENTE.documento);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();

  const fila = page.getByRole('row', { name: new RegExp(creada.cita.codigo) });
  await expect(fila).toBeVisible();

  // Medicina general se cobra: viene marcado «Cobrado» y NO pide nota. Un clic.
  await expect(fila.getByRole('button', { name: 'Cobrado' })).toHaveClass(/activa/);
  await expect(fila.getByPlaceholder(/Por qué/)).toHaveCount(0);
  await expect(fila.getByRole('button', { name: 'Registrar llegada' })).toBeEnabled();

  // La fricción aparece solo al contradecir la política del servicio.
  await fila.getByRole('button', { name: 'No se cobró' }).click();
  await expect(fila.getByPlaceholder(/Por qué no se cobró/)).toBeVisible();
  await expect(fila.getByRole('button', { name: 'Registrar llegada' })).toBeDisabled();

  await fila.getByPlaceholder(/Por qué no se cobró/).fill('Convenio empresarial');
  await expect(fila.getByRole('button', { name: 'Registrar llegada' })).toBeEnabled();
});

test('RN-07.6 · el mostrador nunca muestra una cifra', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Mostrador' }).click();

  /*
   * Guardarraíl deliberado: la plataforma NO maneja importes, y la forma en que eso
   * se rompería es que alguien empiece a pintar precios «solo informativos». Si esta
   * prueba se cae, la conversación es de producto, no de código.
   */
  const texto = (await page.locator('.vista').innerText()).replace(/\s+/g, ' ');
  expect(texto).not.toMatch(/\$\s?\d/);
  expect(texto).not.toMatch(/\d{2,3}\.\d{3}/);
});

test('RN-01.2 · el control no ofrece «Porcentaje» como política de costo', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Servicios y exámenes' }).click();
  await page.getByRole('row', { name: /Ecografía Doppler/ }).getByRole('button', { name: 'Editar' }).click();

  // `porcentaje` nunca se implementó: no hay dónde guardar el porcentaje. Ofrecerlo
  // ahora que el mostrador lee la política significaría «cobra» sin poder decir cuánto.
  const politica = page.getByLabel(/Política de costo|Costo/);
  await expect(politica).toBeVisible();
  await expect(politica.getByRole('option', { name: 'Porcentaje' })).toHaveCount(0);
});
