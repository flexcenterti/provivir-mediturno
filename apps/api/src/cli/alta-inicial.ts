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
import { PrismaClient, type Rol } from '@prisma/client';
import { crearUsuario, ROLES } from './usuarios.comun';
import { CONFIGURACION_BASE } from './configuracion.base';

const prisma = new PrismaClient();

/** Valores por defecto de las reglas. Ver docs/ para el porqué de cada uno. */

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
  for (const c of CONFIGURACION_BASE) {
    const r = await prisma.configuracion.createMany({ data: c, skipDuplicates: true });
    nuevas += r.count;
  }
  console.log(`  ${nuevas > 0 ? '+' : '='} configuración: ${nuevas} parámetro(s) nuevo(s), ${CONFIGURACION_BASE.length - nuevas} ya presente(s)`);

  // ── 3. Usuario ──
  const r = await crearUsuario(prisma, {
    email, nombre, rol, sedeId,
    prestadorId: argumento('prestador-id'),
    recrearClave: bandera('recrear-clave'),
  }).catch((e) => morir((e as Error).message));

  if (r.estado === 'ya-existe') {
    morir(`Ya existe un usuario con ${r.email}. Para cambiarle la contraseña: --recrear-clave`);
  }
  console.log(`  ${r.estado === 'creado' ? '+' : '~'} usuario ${r.email} (${r.rol})`);

  console.log(`
  ────────────────────────────────────────────────
    ${r.email}
    ${r.password}
  ────────────────────────────────────────────────

  Esta contraseña no se vuelve a mostrar y no queda en ningún registro:
  solo existe su hash. Cámbiala tras el primer acceso.

  Para el resto de perfiles: node apps/api/dist/cli/usuarios.js --perfiles-prueba
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
