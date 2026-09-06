import { expect, test } from '@playwright/test';
import { ADMIN, enTresDias, fijarConfig, SIN_VENTANA, ventanaDeUnSoloDia, ASISTENTE, MEDICO, PACIENTE } from './utiles';

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

test('RN-09.9.8 · los interesados son un filtro más de la bandeja', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();

  await expect(page.getByRole('heading', { name: 'Bandeja de la asistente' })).toBeVisible();
  // Ya no están debajo de todo: son un chip más de la misma lista. La regex, por el contador.
  await page.getByRole('button', { name: /^Interesados/ }).click();
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

  /*
   * El rango de fechas ahora vive plegado tras su propio chip: siempre visible robaba
   * dos campos de ancho a una columna de 380px que casi nunca los usa.
   */
  await expect(page.getByLabel(/Desde/)).toHaveCount(0);
  await page.getByRole('button', { name: /Fechas/ }).click();
  await expect(page.getByLabel(/Desde/)).toBeVisible();

  // Con varias asistentes trabajando a la vez, saber cuáles son las tuyas.
  await expect(page.getByText('Solo las mías')).toBeVisible();

  // «Todas» incluye las que el bot resolvió solo, que no salen en las otras dos.
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await expect(page.getByText(/las que el bot resolvió solo/)).toBeVisible();

  // Y en pendientes no hay rango: ni el campo ni el chip que lo despliega.
  await page.getByRole('button', { name: 'Pendientes', exact: true }).click();
  await expect(page.getByLabel(/Desde/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Fechas/ })).toHaveCount(0);
});

/**
 * Fase 18 · el encargo del cliente, literal: «la interfaz de gestión de conversaciones
 * es muy compleja». Era una tabla de seis columnas y un modal que la tapaba entera, así
 * que para pasar de una conversación a la siguiente había que cerrarlo.
 */
test('abrir una conversación no tapa la lista', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();

  const lista = page.locator('.bandeja-lista');
  await lista.locator('.fila-conv').first().click();

  // Las dos cosas a la vez, que es el punto entero del rediseño.
  await expect(page.locator('.bandeja-hilo .burbuja').first()).toBeVisible();
  await expect(lista).toBeVisible();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(page.locator('.fila-activa')).toHaveCount(1);
});

test('se pasa de una conversación a la siguiente sin cerrar nada', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();
  await page.getByRole('button', { name: 'Todas', exact: true }).click();

  const filas = page.locator('.bandeja-lista .fila-conv');
  await filas.nth(0).click();
  const primera = await page.locator('.bandeja-hilo h3').textContent();

  // Sin ningún clic de cierre por el medio: se pulsa la siguiente y ya.
  await filas.nth(1).click();
  await expect(page.locator('.bandeja-hilo h3')).not.toHaveText(primera ?? '');
  await expect(page.locator('.fila-activa')).toHaveCount(1);
});

test('el hilo dice quién escribió cada mensaje y separa los días', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();
  await page.locator('.bandeja-lista .fila-conv').first().click();

  await expect(page.locator('.burbuja.de-paciente').first()).toBeVisible();
  await expect(page.locator('.burbuja.de-clinica').first()).toBeVisible();
  // El bot y una persona eran indistinguibles antes de la fase 12.
  await expect(page.locator('.burbuja.de-clinica time').first()).toContainText(/Asistente virtual|Paula/);
  // Un mensaje de ayer y dos de hoy: tiene que haber dos separadores.
  await expect(page.locator('.chat-dia')).toHaveCount(2);
  await expect(page.getByText('Hoy', { exact: true })).toBeVisible();
});

/**
 * `situacion()` es la máquina de estados más delicada de la pantalla y no tenía ni una
 * prueba: decide si se puede escribir, si hay que reabrir o si solo cabe plantilla.
 */
test('fuera de la ventana de 24 h no se puede escribir, y se dice por qué', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();

  /*
   * Se localiza por su previsualización y no por el buscador: el buscador va contra el
   * paciente (nombre, documento, teléfono), no contra el texto de los mensajes.
   * La segunda conversación del seed lleva cuatro días sin mensaje entrante.
   */
  await page.locator('.bandeja-lista .fila-conv')
    .filter({ hasText: 'orden médica' }).first().click();
  await expect(page.locator('.aviso-ventana')).toContainText(/más de 24 h/);
  await expect(page.locator('.redactor textarea')).toBeDisabled();
});

test('sin conversación elegida se explica qué hacer', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();

  await expect(page.getByText(/Elige una conversación/)).toBeVisible();
  await expect(page.locator('.burbuja')).toHaveCount(0);
});

test('el chip de interesados abre su conversación a la derecha', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();
  await page.getByRole('button', { name: /^Interesados/ }).click();

  await expect(page.getByRole('heading', { name: 'Interesados sin agendar' })).toBeVisible();
  // «Escribirle yo» era un botón dentro de una tabla aparte; ahora la fila es el botón.
  await page.locator('.bandeja-lista .fila-conv').first().click();
  await expect(page.locator('.bandeja-hilo .burbuja').first()).toBeVisible();
});

test('tomar una conversación la pone a tu nombre sin recargar', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: /Bandeja asistente/ }).click();
  await page.locator('.bandeja-lista .fila-conv').first().click();

  await page.getByRole('button', { name: 'Tomar', exact: true }).click();

  // En la cabecera y en la fila: prueba de que el refresco cruzado lista↔hilo funciona.
  // `.hilo-cab .nota` y no `.bandeja-hilo .nota`: el redactor tiene la suya.
  await expect(page.locator('.hilo-cab .nota')).toContainText('(tú)');
  await expect(page.locator('.fila-activa')).toContainText('tú');
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

/**
 * Fase 16 · quien agenda por el portal no recibe la confirmación —nunca escribió, no
 * hay ventana de 24 h y no hay plantilla aprobada— y esa cita se veía igual que
 * cualquier otra. La ficha lo dice ahora, con el número a mano para llamar.
 */
test('la ficha de la cita dice si al paciente le pudo llegar el aviso', async ({ page }) => {
  await entrar(page);

  const token = await page.evaluate(() => sessionStorage.getItem('accessToken'));
  const cabeceras = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  const pacientes = await (await page.request.get(
    `/api/pacientes?q=${PACIENTE.documento}`, { headers: cabeceras })).json();
  const cupos = await (await page.request.get(
    `/api/cupos?servicioId=mg&fecha=${hoy}&limite=1`, { headers: cabeceras })).json();
  test.skip(cupos.length === 0, 'Hoy no hay agenda de medicina general (domingo o festivo)');

  const creada = await (await page.request.post('/api/citas', {
    headers: cabeceras,
    data: {
      pacienteId: pacientes.datos[0].id, servicioId: 'mg', fecha: hoy,
      hora: cupos[0].hora, prestadorId: cupos[0].prestadorId, origen: 'mostrador',
    },
  })).json();

  await page.getByRole('button', { name: 'Mostrador' }).click();
  await page.getByPlaceholder(/Código, documento, nombre o teléfono/).fill(PACIENTE.documento);
  await page.getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.getByRole('row', { name: new RegExp(creada.cita.codigo) })
    .getByRole('button', { name: creada.cita.codigo }).click();

  // El seed no tiene conversaciones: este paciente nunca ha escrito por WhatsApp.
  const modal = page.locator('.modal');
  await expect(modal.getByText(/Nunca ha escrito por WhatsApp/)).toBeVisible();
  // Y lo que la asistente puede hacer al respecto, con el número delante.
  await expect(modal.getByText(/Llámalo al \+?\d/)).toBeVisible();

  /*
   * «Escribirle» queda inerte hasta que Meta apruebe la plantilla, y se afirma también
   * el MOTIVO en pantalla: un botón apagado sin explicación se lee como un fallo de la
   * plataforma, y comprobar solo `toBeDisabled()` pasaría verde con esa versión.
   */
  await expect(modal.getByRole('button', { name: 'Escribirle' })).toBeDisabled();
  await expect(modal.getByText(/No hay plantilla aprobada en Meta/)).toBeVisible();
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

// ─────────────── Fase 19 · alta y baja de pantallas de sala ───────────────

/**
 * Deja la sección Pantallas abierta y sin ninguna fila.
 *
 * El seed crea tres desde el catálogo de demostración y se retiran **por la API**, no
 * por la interfaz: hacerlo con clics tenía una carrera real —`count()` ve una fila que
 * el `recargar()` en vuelo está a punto de quitar, y el clic se queda esperando un
 * elemento ya desprendido—. El borrado por interfaz se prueba aparte, que es su sitio.
 */
async function pantallasVacias(page: import('@playwright/test').Page): Promise<void> {
  const api = page.request;
  const login = await api.post('http://localhost:3000/api/auth/login', { data: ADMIN });
  const { accessToken, token } = await login.json();
  const cabeceras = { Authorization: `Bearer ${accessToken ?? token}` };

  const r = await api.get('http://localhost:3000/api/pantallas', { headers: cabeceras });
  for (const p of await r.json()) {
    await api.delete(`http://localhost:3000/api/pantallas/${p.id}`, { headers: cabeceras });
  }

  await entrar(page);
  await page.getByRole('button', { name: 'Pantallas de sala' }).click();
  await expect(page.getByRole('columnheader', { name: 'Pantalla' })).toBeVisible();
}

/*
 * Mata: quitar el `<tr>` del estado vacío. Sin él la tabla son encabezados sobre el
 * vacío y no hay nada que indique qué hacer — que es literalmente lo que el cliente
 * estaba viendo en producción, con cero filas y sin forma de crear ninguna.
 */
test('RN-11 · sin ninguna pantalla, la tabla dice qué hacer', async ({ page }) => {
  await pantallasVacias(page);
  await expect(page.getByText(/Todavía no hay ninguna pantalla/)).toBeVisible();
});

/*
 * Mata: que el alta no recargue la lista (parece que no se guardó y se crean tres), o
 * que el formulario mande PATCH sobre una pantalla que no existe.
 */
test('RN-11 · se crea una pantalla desde cero y aparece en la lista', async ({ page }) => {
  await pantallasVacias(page);

  await page.getByRole('button', { name: 'Nueva pantalla' }).click();
  await page.getByLabel('Nombre').fill('Sala de pruebas');
  await page.getByRole('button', { name: 'Laboratorio clínico' }).click();
  await page.getByRole('button', { name: 'Crear pantalla' }).click();

  await expect(page.getByRole('cell', { name: /Sala de pruebas/ })).toBeVisible();
  await expect(page.getByText(/Todavía no hay ninguna pantalla/)).toHaveCount(0);
});

/*
 * Mata: copiar el enlace relativo (`/tv/?pantalla=…`). El punto entero del botón es
 * que lo copiado se pega en un WhatsApp o en la barra de un stick, donde una ruta
 * relativa no vale nada.
 */
test('RN-11 · «Copiar enlace» deja una URL absoluta con el id de la pantalla', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await pantallasVacias(page);

  await page.getByRole('button', { name: 'Nueva pantalla' }).click();
  await page.getByLabel('Nombre').fill('Sala del enlace');
  await page.getByRole('button', { name: 'Crear pantalla' }).click();
  await expect(page.getByRole('cell', { name: /Sala del enlace/ })).toBeVisible();

  await page.getByRole('button', { name: 'Copiar enlace' }).click();
  await expect(page.getByRole('button', { name: 'Copiado' })).toBeVisible();

  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiado).toMatch(/^https?:\/\/.+\?pantalla=[0-9a-f-]{36}$/);
});

/*
 * Mata: retirar sin `confirm()`. El diálogo nunca dispararía y la aserción de que sí
 * lo hizo falla — es a la vez el error de un clic de más y el procedimiento de
 * revocación de un enlace filtrado, así que no puede ser silencioso.
 */
test('RN-11.6 · retirar una pantalla pide confirmación y avisa de que el enlace muere', async ({ page }) => {
  await pantallasVacias(page);

  await page.getByRole('button', { name: 'Nueva pantalla' }).click();
  await page.getByLabel('Nombre').fill('Sala que se retira');
  await page.getByRole('button', { name: 'Crear pantalla' }).click();
  await expect(page.getByRole('cell', { name: /Sala que se retira/ })).toBeVisible();

  let texto = '';
  page.once('dialog', (d) => { texto = d.message(); void d.accept(); });

  await page.getByRole('button', { name: 'Configurar' }).click();
  await page.getByRole('button', { name: 'Retirar pantalla' }).click();

  await expect(page.getByRole('cell', { name: /Sala que se retira/ })).toHaveCount(0);
  expect(texto).toContain('Sala que se retira');
  // Lo que hace útil el aviso no es preguntar, es decir qué se rompe.
  expect(texto).toMatch(/dejará de funcionar/);
});

/*
 * Mata: quitar el aviso de servicios vacíos. Una pantalla así no recibe un solo
 * llamado en toda su vida y se instala sin que nadie lo note hasta verla muda.
 */
test('RN-11.1 · una pantalla sin servicios queda marcada en la lista y en el formulario', async ({ page }) => {
  await pantallasVacias(page);

  await page.getByRole('button', { name: 'Nueva pantalla' }).click();
  await expect(page.getByText(/no mostrará ningún llamado/)).toBeVisible();
  await page.getByLabel('Nombre').fill('Sala sin configurar');
  await page.getByRole('button', { name: 'Crear pantalla' }).click();

  await expect(page.getByText(/Sin servicios · no mostrará llamados/)).toBeVisible();
});

// ─────────────── Fase 20 · anuncios de la sala ───────────────

/** Un PNG de 1×1 de verdad: el servidor valida por la firma, no por la extensión. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/*
 * Mata: que la tarjeta no recargue tras subir —parece que no se guardó y se suben
 * tres—, o que la miniatura apunte a otra ruta que la del televisor. Usar la MISMA URL
 * pública es lo que convierte esta vista previa en la prueba de que el televisor
 * funciona: si aquí se ve, allí se ve.
 */
test('RN-11.7 · se sube un anuncio y la miniatura sale de la misma ruta que usa el televisor', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Pantallas de sala' }).click();
  await expect(page.getByRole('heading', { name: 'Anuncios de la sala' })).toBeVisible();

  page.on('dialog', (d) => void d.accept());
  // Deja la tarjeta vacía, sea cual sea el estado que dejó otra prueba.
  for (;;) {
    const retirar = page.locator('.anuncio-ficha').getByRole('button', { name: 'Retirar' }).first();
    if (await retirar.count() === 0) break;
    await retirar.click();
    await expect(page.locator('.anuncio-ficha')).toHaveCount(await page.locator('.anuncio-ficha').count() - 1);
  }
  await expect(page.getByText(/Todavía no hay anuncios/)).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'promocion.png', mimeType: 'image/png', buffer: PNG_1x1,
  });

  const miniatura = page.locator('.anuncio-ficha img');
  await expect(miniatura).toHaveCount(1);
  await expect(miniatura).toHaveAttribute('src', /^\/api\/pantallas\/anuncios\/[0-9a-f-]{36}\/imagen$/);
  await expect(page.getByText('1 de 4')).toBeVisible();

  /*
   * Se retira al terminar. Los anuncios son de SEDE, así que dejarlo aquí se lo
   * encuentran las pruebas del televisor —otro proyecto, que corre después— con una
   * franja que no pidieron.
   */
  await page.locator('.anuncio-ficha').getByRole('button', { name: 'Retirar' }).click();
  await expect(page.locator('.anuncio-ficha')).toHaveCount(0);
});

/*
 * Mata: aceptar cualquier archivo con extensión de imagen. Es el mismo defecto que
 * tienen hoy los otros dos endpoints de subida del sistema, y aquí el archivo acabaría
 * servido desde una ruta pública.
 */
test('RN-11.7 · un archivo que no es una imagen se rechaza y lo dice', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Pantallas de sala' }).click();
  await expect(page.getByRole('heading', { name: 'Anuncios de la sala' })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: 'trampa.png', mimeType: 'image/png', buffer: Buffer.from('<!doctype html><script>'),
  });

  await expect(page.getByText(/no es una imagen/i)).toBeVisible();
});

// ─────────────── Fase 21 · editar y retirar agendas ───────────────

let contadorFranjas = 0;

/**
 * Crea una franja propia por API y devuelve su marca.
 *
 * La marca es **única por llamada**: las retiradas de las pruebas anteriores siguen
 * listándose al activar «Ver retiradas», y con una marca compartida la fila que se busca
 * es ambigua. Depender de las franjas del seed, además, haría la prueba del día.
 */
async function franjaDePrueba(request: import('@playwright/test').APIRequestContext): Promise<string> {
  const marca = `C-f21-${++contadorFranjas}`;
  const login = await request.post('http://localhost:3000/api/auth/login', { data: ADMIN });
  const { accessToken, token } = await login.json();
  const headers = { Authorization: `Bearer ${accessToken ?? token}` };

  // Se limpian las de este prestador para que la tabla sea predecible.
  const previas = await (await request.get('http://localhost:3000/api/agendas?prestadorId=jo', { headers })).json();
  for (const a of previas) {
    await request.post(`http://localhost:3000/api/agendas/${a.id}/retirar`, { headers, data: { confirmar: true } });
  }

  const r = await request.post('http://localhost:3000/api/agendas', {
    headers,
    data: {
      prestadorId: 'jo', modo: 'semanal', diasSemana: [1, 2],
      horaIni: '07:00', horaFin: '12:00', slotMin: 15,
      consultorio: marca,
    },
  });
  expect(r.status(), 'no se pudo crear la franja de prueba').toBe(201);
  return marca;
}

/*
 * Mata: reutilizar `FormAgenda` sin inicializarlo desde la fila. Se abriría vacío —sería
 * «Nueva agenda» con otro título— y guardar crearía una franja duplicada en vez de
 * corregir la que hay. Y el texto del botón es literalmente lo que marcó el cliente en
 * su captura.
 */
test('RN-06.6 · «Editar» abre la franja con sus valores y el botón dice Guardar', async ({ page, request }) => {
  const marca = await franjaDePrueba(request);
  await entrar(page);
  await page.getByRole('button', { name: 'Gestión de agendas' }).click();
  await page.getByRole('combobox').first().selectOption('jo');

  await page.getByRole('row').filter({ hasText: marca }).getByRole('button', { name: 'Editar' }).click();

  await expect(page.getByRole('heading', { name: 'Editar agenda' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear', exact: true })).toHaveCount(0);
  // Los valores de la fila, no los del formulario en blanco.
  await expect(page.getByLabel('Desde')).toHaveValue('07:00');
  await expect(page.getByLabel('Hasta')).toHaveValue('12:00');
  // Mover la franja a otro médico no es editarla.
  await expect(page.getByLabel('Prestador')).toBeDisabled();
});

/*
 * Mata: no guardar los días, o no recargar la tabla tras guardar. Es el «adicionar y
 * eliminar días de atención» que pidió el cliente, y sin la recarga parece que no se
 * guardó y se acaban creando franjas de más.
 */
test('RN-06.6 · se añade un día y la tabla lo refleja', async ({ page, request }) => {
  const marca = await franjaDePrueba(request);
  await entrar(page);
  await page.getByRole('button', { name: 'Gestión de agendas' }).click();
  await page.getByRole('combobox').first().selectOption('jo');
  const fila = page.getByRole('row').filter({ hasText: marca });
  await expect(fila).toContainText('Lun, Mar');

  await fila.getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('button', { name: 'Mié', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByRole('row').filter({ hasText: marca })).toContainText('Lun, Mar, Mié');
});

/*
 * Mata: retirar sin confirmar, o no dejar camino de vuelta. Un borrado lógico que solo se
 * puede deshacer por SQL es un borrado duro con filas muertas de propina.
 */
test('RN-06.6 · retirar una franja pide confirmación, y se puede reactivar', async ({ page, request }) => {
  const marca = await franjaDePrueba(request);
  await entrar(page);
  await page.getByRole('button', { name: 'Gestión de agendas' }).click();
  await page.getByRole('combobox').first().selectOption('jo');

  let texto = '';
  page.once('dialog', (d) => { texto = d.message(); void d.accept(); });

  await page.getByRole('row').filter({ hasText: marca }).getByRole('button', { name: 'Editar' }).click();
  await page.getByRole('button', { name: 'Retirar franja' }).click();

  expect(texto).toContain('07:00');
  await expect(page.getByRole('row').filter({ hasText: marca })).toHaveCount(0);

  // Y vuelve, que es lo que distingue una baja lógica de un borrado.
  await page.getByLabel('Ver retiradas').check();
  const retirada = page.getByRole('row').filter({ hasText: marca });
  await expect(retirada).toContainText('Retirada');
  await retirada.getByRole('button', { name: 'Reactivar' }).click();

  await page.getByLabel('Ver retiradas').uncheck();
  await expect(page.getByRole('row').filter({ hasText: marca })).toContainText('Lun, Mar');
});

// ─────────────── Fase 22 · RN-04.8 · la ventana de autoagendamiento ───────────────

/*
 * Se deja apagada al terminar cada prueba: el estado de configuración lo hereda todo lo
 * que corra después, y estas pruebas son las únicas del navegador que la encienden.
 */
test.afterEach(async ({ request }) => { await fijarConfig(request, SIN_VENTANA); });

/**
 * Mata: quitar el «Resultado de hoy» y dejar solo los siete desplegables.
 *
 * Siete filas de días de la semana no dicen qué va a pasar hoy. Sin el resultado en
 * texto, la única forma de saber qué se acaba de configurar es abrir el portal y probar.
 */
test('RN-04.8 · la pantalla dice qué ventana sale de la tabla, no solo la tabla', async ({ page, request }) => {
  await fijarConfig(request, {
    autoagendamiento_ventana_activa: 'true',
    autoagendamiento_ventana_dias: ventanaDeUnSoloDia(enTresDias()),
    autoagendamiento_dias_excluidos: '',
  });

  await entrar(page);
  await page.getByRole('button', { name: 'Administración' }).click();
  await page.getByRole('button', { name: 'Autoagendamiento' }).click();

  const resultado = page.locator('.card', { hasText: 'Resultado de hoy' });
  await expect(resultado).toContainText('Hoy es');
  // El día concreto, escrito como lo lee una persona: «viernes, 11 de septiembre».
  await expect(resultado).toContainText(
    new Date(`${enTresDias()}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' }),
  );
});

/**
 * Mata: guardar sin invalidar la caché de configuración.
 *
 * El servicio cachea en memoria; si `fijar()` no invalidara, el operador guardaría, la
 * pantalla se lo confirmaría, y el portal seguiría ofreciendo la ventana anterior hasta
 * el siguiente reinicio. Por eso la comprobación no es que la pantalla se actualice
 * —eso solo prueba que releyó— sino que **el endpoint público ya responde distinto**.
 */
test('RN-04.8 · cambiar la tabla cambia de inmediato lo que el portal ofrece', async ({ page, request }) => {
  await fijarConfig(request, {
    autoagendamiento_ventana_activa: 'true',
    autoagendamiento_dias_excluidos: '',
    autoagendamiento_ventana_dias: ventanaDeUnSoloDia(enTresDias()),
  });

  const antes = await (await request.get('http://localhost:3000/api/portal/ventana')).json();
  expect(antes.fechas).toEqual([enTresDias()]);

  await entrar(page);
  await page.getByRole('button', { name: 'Administración' }).click();
  await page.getByRole('button', { name: 'Autoagendamiento' }).click();

  // Se corre la ventana un día: la fila de hoy pasa a apuntar a mañana del día objetivo.
  const objetivo = new Date(`${enTresDias()}T12:00:00Z`);
  objetivo.setUTCDate(objetivo.getUTCDate() + 1);
  const nuevoIso = objetivo.toISOString().slice(0, 10);
  const nuevoDia = ((objetivo.getUTCDay() + 6) % 7) + 1;

  // El día de la semana de HOY en la sede, que es la fila que gobierna la ventana de hoy.
  const hoySede = new Date(`${enTresDias()}T12:00:00Z`);
  hoySede.setUTCDate(hoySede.getUTCDate() - 3);
  const hoyDia = DIAS_ES[((hoySede.getUTCDay() + 6) % 7)]!;

  // Por la etiqueta, no por la posición: cada desplegable dice qué fila y qué extremo
  // gobierna, que es lo que también necesita quien usa un lector de pantalla.
  await page.getByLabel(`Desde · si agenda un ${hoyDia}`).selectOption(String(nuevoDia));
  await page.getByLabel(`Hasta · si agenda un ${hoyDia}`).selectOption(String(nuevoDia));
  await page.getByRole('button', { name: 'Guardar la tabla' }).click();
  await expect(page.getByText(/Regla actualizada/)).toBeVisible({ timeout: 15_000 });

  const despues = await (await request.get('http://localhost:3000/api/portal/ventana')).json();
  expect(despues.fechas).toEqual([nuevoIso]);
});

const DIAS_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
