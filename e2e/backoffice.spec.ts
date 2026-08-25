import { expect, test } from '@playwright/test';
import { ADMIN, ASISTENTE } from './utiles';

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

  const campo = page.getByLabel(/Margen de tolerancia/);
  const original = await campo.inputValue();

  await campo.fill('12');
  await page.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(page.getByText(/Regla actualizada/)).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByRole('button', { name: 'Reglas de prioridad' }).click();
  await expect(page.getByLabel(/Margen de tolerancia/)).toHaveValue('12');

  // Se devuelve para no dejar la base de pruebas con un valor distinto del seed.
  await page.getByLabel(/Margen de tolerancia/).fill(original);
  await page.getByRole('button', { name: 'Guardar' }).first().click();
  await expect(page.getByText(/Regla actualizada/)).toBeVisible({ timeout: 15_000 });
});
