/**
 * Gestión de usuarios · no existe pantalla para esto todavía.
 *
 *   node apps/api/dist/cli/usuarios.js                       lista quién hay
 *   node apps/api/dist/cli/usuarios.js --perfiles-prueba     uno por cada rol
 *   node apps/api/dist/cli/usuarios.js --crear --email a@b --nombre "X" --rol asistente
 *   node apps/api/dist/cli/usuarios.js --clave --email a@b   contraseña nueva
 *   node apps/api/dist/cli/usuarios.js --desactivar --email a@b
 *   node apps/api/dist/cli/usuarios.js --purgar-prueba       retira los de prueba
 *
 * Las contraseñas se generan aquí y se muestran UNA vez: en la base solo queda su
 * hash. Nunca se piden por parámetro, que quedaría en el historial del shell.
 */
import { PrismaClient, type Rol } from '@prisma/client';
import { crearUsuario, QUE_HACE, ROLES } from './usuarios.comun';

const prisma = new PrismaClient();

/**
 * Los de prueba llevan este sufijo para poder retirarlos de un tirón antes de
 * atender pacientes de verdad. Cuatro cuentas de prueba olvidadas en producción
 * son cuatro puertas abiertas.
 */
const DOMINIO_PRUEBA = '@prueba.provivir.local';

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const bandera = (n: string) => process.argv.includes(`--${n}`);
function morir(m: string): never {
  console.error(`\n  ✗ ${m}\n`);
  process.exit(1);
}

function tabla(filas: Array<{ email: string; password: string; rol: Rol }>): void {
  const ancho = Math.max(...filas.map((f) => f.email.length));
  console.log('\n  ┌─ Estas contraseñas no se vuelven a mostrar ─────────────────');
  for (const f of filas) {
    console.log(`  │ ${f.rol.padEnd(10)} ${f.email.padEnd(ancho)}  ${f.password}`);
  }
  console.log('  └────────────────────────────────────────────────────────────\n');
  for (const f of filas) console.log(`  ${f.rol.padEnd(10)} ${QUE_HACE[f.rol]}`);
  console.log();
}

async function listar(): Promise<void> {
  const usuarios = await prisma.usuario.findMany({
    orderBy: [{ rol: 'asc' }, { email: 'asc' }],
    select: { email: true, nombre: true, rol: true, activo: true, ultimoAcceso: true, prestadorId: true },
  });

  if (!usuarios.length) {
    console.log('\n  No hay usuarios. Créalos con --perfiles-prueba o --crear.\n');
    return;
  }

  console.log(`\n  ${usuarios.length} usuario(s):\n`);
  for (const u of usuarios) {
    const marca = u.activo ? ' ' : '✗';
    const acceso = u.ultimoAcceso ? u.ultimoAcceso.toISOString().slice(0, 16).replace('T', ' ') : 'nunca entró';
    const pres = u.prestadorId ? ` → ${u.prestadorId}` : '';
    console.log(`  ${marca} ${u.rol.padEnd(10)} ${u.email.padEnd(38)} ${u.nombre.padEnd(22)} ${acceso}${pres}`);
  }
  console.log(`\n  ✗ = desactivado. Los de prueba terminan en ${DOMINIO_PRUEBA}\n`);
}

async function perfilesDePrueba(sedeId: string): Promise<void> {
  // El rol prestador se ata a una ficha real (RN-06.2): se toma la primera que haya.
  const prestador = await prisma.prestador.findFirst({ where: { activo: true }, orderBy: { id: 'asc' } });

  const plan: Array<{ rol: Rol; nombre: string; prestadorId?: string }> = [
    { rol: 'admin', nombre: 'Admin de prueba' },
    { rol: 'asistente', nombre: 'Asistente de prueba' },
    { rol: 'pantalla', nombre: 'Pantalla de prueba' },
  ];

  if (prestador) {
    plan.push({ rol: 'prestador', nombre: `${prestador.nombre} (prueba)`, prestadorId: prestador.id });
  } else {
    console.log('\n  ! Sin prestadores en la base: se omite el perfil médico.');
    console.log('    Carga el catálogo primero: node apps/api/dist/cli/datos-demo.js\n');
  }

  const creados = [];
  for (const p of plan) {
    const r = await crearUsuario(prisma, {
      email: `${p.rol}${DOMINIO_PRUEBA}`,
      nombre: p.nombre, rol: p.rol, sedeId, prestadorId: p.prestadorId,
      // Repetir el comando renueva las claves: si se perdieron, no hay que borrar nada.
      recrearClave: true,
    });
    if (r.estado !== 'ya-existe') creados.push({ email: r.email, password: r.password, rol: r.rol });
  }

  tabla(creados);
  console.log(`  Son cuentas DE PRUEBA. Retíralas antes de atender pacientes reales:`);
  console.log('    node apps/api/dist/cli/usuarios.js --purgar-prueba\n');
}

async function main(): Promise<void> {
  const sedeId = process.env.SEDE_ID ?? morir('Falta SEDE_ID en el entorno.');

  if (bandera('purgar-prueba')) {
    const r = await prisma.usuario.deleteMany({ where: { email: { endsWith: DOMINIO_PRUEBA } } });
    console.log(`\n  ${r.count} cuenta(s) de prueba retirada(s).\n`);
    return;
  }

  if (bandera('perfiles-prueba')) {
    if (!(await prisma.sede.findUnique({ where: { id: sedeId } }))) {
      morir(`No existe la sede "${sedeId}". Ejecuta antes alta-inicial.js.`);
    }
    return perfilesDePrueba(sedeId);
  }

  const email = arg('email');

  if (bandera('desactivar') || bandera('activar')) {
    if (!email) morir('Falta --email.');
    const activo = bandera('activar');
    const u = await prisma.usuario.updateMany({ where: { email: email!.toLowerCase() }, data: { activo } });
    if (!u.count) morir(`No existe ningún usuario con ${email}.`);
    console.log(`\n  ${email} ${activo ? 'activado' : 'desactivado'}.\n`);
    return;
  }

  if (bandera('crear') || bandera('clave')) {
    if (!email?.includes('@')) morir('Falta --email o no es una dirección válida.');
    const rol = (arg('rol') ?? 'asistente') as Rol;
    if (!ROLES.includes(rol)) morir(`Rol inválido: ${rol}. Válidos: ${ROLES.join(', ')}`);

    const r = await crearUsuario(prisma, {
      email: email!, nombre: arg('nombre') ?? email!, rol, sedeId,
      prestadorId: arg('prestador-id'),
      recrearClave: bandera('clave'),
    }).catch((e) => morir((e as Error).message));

    if (r.estado === 'ya-existe') {
      morir(`Ya existe un usuario con ${r.email}. Para darle una contraseña nueva: --clave --email ${r.email}`);
    }
    tabla([{ email: r.email, password: r.password, rol: r.rol }]);
    return;
  }

  return listar();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
