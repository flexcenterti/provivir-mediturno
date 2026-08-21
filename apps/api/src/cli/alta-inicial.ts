/**
 * Alta inicial de producción · Grupo Provivir
 *
 * El seed NO corre en producción: crea usuarios con una contraseña conocida y
 * datos del prototipo. Este script hace lo mínimo para que una instalación
 * limpia sea utilizable, sin inventar datos del cliente:
 *
 *   1. La sede (D1 · sede única), tomada de SEDE_ID.
 *   2. Los parámetros de configuración, solo los que falten.
 *   3. Un usuario con contraseña fuerte, generada aquí y mostrada una sola vez.
 *
 * NO crea servicios, prestadores ni agendas: eso es el catálogo real de la
 * clínica y se carga desde el backoffice, que existe justo para ello.
 *
 * Vive en src/ y no en scripts/ a propósito: así lo compila `nest build` y viaja
 * dentro de la imagen, que no lleva ts-node ni los fuentes. Colgarlo de scripts/
 * exigiría meter ese directorio en el `include`, y eso desplaza el rootDir y
 * anida todo el dist bajo dist/src.
 *
 * En producción:
 *   node apps/api/dist/cli/alta-inicial.js --email admin@grupoprovivir.com --nombre "John Mendoza"
 *
 * En desarrollo:
 *   npx ts-node src/cli/alta-inicial.ts --email ... --nombre ...
 *
 * Opciones:
 *   --rol admin|asistente|prestador|pantalla   (por defecto: admin)
 *   --sede-nombre "CDC Oriente"
 *   --recrear-clave        cambia la contraseña de un usuario que ya existe
 *
 * Idempotente: repetirlo no duplica ni pisa nada, salvo con --recrear-clave.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient, type Rol } from '@prisma/client';
import { hashearPassword } from '../auth/argon2.opciones';

const prisma = new PrismaClient();

/** Valores por defecto de las reglas. Ver docs/ para el porqué de cada uno. */
const CONFIGURACION = [
  { clave: 'hueco_max_min', valor: '0', descripcion: 'RN-03.2 · Hueco máximo tolerado al recomendar cupos. 0 = compactar al máximo.' },
  { clave: 'ventana_control_dias_defecto', valor: '10', descripcion: 'RN-01.3 · Ventana de control por defecto si el prestador no define la suya.' },
  { clave: 'kiosko_activo', valor: 'false', descripcion: 'D3 · El kiosko queda construido pero apagado.' },
  { clave: 'umbral_confianza_ia', valor: '70', descripcion: 'RN-08 · Bajo este umbral la IA escala a la asistente.' },
  { clave: 'intervalo_institucional_min', valor: '10', descripcion: 'RN-11.2 · Cada cuántos minutos se interrumpe el canal para el video institucional.' },
  { clave: 'anticipacion_llegada_min', valor: '15', descripcion: 'Minutos de anticipación con que se permite registrar llegada.' },
  { clave: 'tolerancia_retraso_min', valor: '10', descripcion: 'Tolerancia de retraso antes de degradar la prioridad en cola.' },
];

const ROLES: readonly Rol[] = ['admin', 'asistente', 'prestador', 'pantalla'];

/**
 * Contraseña generada, no elegida. Se excluyen los caracteres que se confunden
 * al dictarla por teléfono (O/0, l/1/I) porque alguien la va a dictar.
 */
function generarPassword(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const simbolos = '!@#$%&*?';
  const tomar = (fuente: string, n: number) =>
    Array.from(randomBytes(n)).map((b) => fuente[b % fuente.length]).join('');
  // Se baraja para que los símbolos no queden siempre al final.
  const bruto = (tomar(alfabeto, 18) + tomar(simbolos, 3)).split('');
  for (let i = bruto.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [bruto[i], bruto[j]] = [bruto[j]!, bruto[i]!];
  }
  return bruto.join('');
}

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const bandera = (nombre: string) => process.argv.includes(`--${nombre}`);

function morir(mensaje: string): never {
  console.error(`\n  ✗ ${mensaje}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const sedeId = process.env.SEDE_ID;
  if (!sedeId) morir('Falta SEDE_ID en el entorno.');

  const email = argumento('email')?.trim().toLowerCase();
  const nombre = argumento('nombre')?.trim();
  const rol = (argumento('rol') ?? 'admin') as Rol;

  if (!email || !email.includes('@')) morir('Falta --email o no es una dirección válida.');
  if (!nombre) morir('Falta --nombre.');
  if (!ROLES.includes(rol)) morir(`Rol inválido: ${rol}. Válidos: ${ROLES.join(', ')}`);

  console.log(`\nAlta inicial · sede ${sedeId}\n`);

  // ── 1. Sede ──
  const sede = await prisma.sede.findUnique({ where: { id: sedeId } });
  if (sede) {
    console.log(`  = sede "${sede.nombre}" ya existe`);
  } else {
    const creada = await prisma.sede.create({
      data: {
        id: sedeId,
        nombre: argumento('sede-nombre') ?? 'CDC Oriente',
        direccion: argumento('sede-direccion') ?? '',
        waNumero: argumento('sede-whatsapp') ?? '',
        horario: argumento('sede-horario') ?? '',
      },
    });
    console.log(`  + sede "${creada.nombre}" creada`);
    if (!creada.direccion) {
      console.log('    (dirección, WhatsApp y horario vacíos: complétalos desde el backoffice)');
    }
  }

  // ── 2. Configuración ──
  // Solo se crean las que faltan: un valor ya ajustado desde el backoffice es
  // una decisión operativa y este script no tiene por qué revertirla.
  let nuevas = 0;
  for (const c of CONFIGURACION) {
    const r = await prisma.configuracion.createMany({ data: c, skipDuplicates: true });
    nuevas += r.count;
  }
  console.log(`  ${nuevas > 0 ? '+' : '='} configuración: ${nuevas} parámetro(s) nuevo(s), ${CONFIGURACION.length - nuevas} ya presente(s)`);

  // ── 3. Usuario ──
  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente && !bandera('recrear-clave')) {
    morir(`Ya existe un usuario con ${email}. Para cambiarle la contraseña: --recrear-clave`);
  }

  if (rol === 'prestador') {
    const prestadorId = argumento('prestador-id');
    if (!prestadorId) morir('Un usuario con rol=prestador necesita --prestador-id (RN-06.2).');
    if (!(await prisma.prestador.findUnique({ where: { id: prestadorId } }))) {
      morir(`No existe el prestador "${prestadorId}". Créalo antes desde el backoffice.`);
    }
  }

  const password = generarPassword();
  const hashPassword = await hashearPassword(password);
  const prestadorId = argumento('prestador-id') ?? null;

  if (existente) {
    await prisma.usuario.update({ where: { email }, data: { hashPassword, activo: true } });
    console.log(`  ~ contraseña de ${email} reemplazada`);
  } else {
    await prisma.usuario.create({ data: { nombre, email, rol, prestadorId, hashPassword, sedeId } });
    console.log(`  + usuario ${email} (${rol}) creado`);
  }

  console.log(`
  ────────────────────────────────────────────────
    ${email}
    ${password}
  ────────────────────────────────────────────────

  Esta contraseña no se vuelve a mostrar y no queda en ningún registro:
  solo existe su hash. Cámbiala tras el primer acceso.
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
