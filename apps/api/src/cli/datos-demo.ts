/**
 * Carga (o retira) el catálogo de demostración · insumos P1–P10.
 *
 * Sirve para poder probar de punta a punta mientras el cliente entrega sus datos
 * reales. Todo lo que crea queda marcado y `--purgar` lo deshace.
 *
 *   node apps/api/dist/cli/datos-demo.js
 *   node apps/api/dist/cli/datos-demo.js --contactos 500
 *   node apps/api/dist/cli/datos-demo.js --purgar
 *
 * Requiere que la sede exista: córrase antes alta-inicial.js.
 */
import { PrismaClient } from '@prisma/client';
import { cargarCatalogo, purgarCatalogo } from './catalogo.demo';

const prisma = new PrismaClient();

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const sedeId = process.env.SEDE_ID;
  if (!sedeId) {
    console.error('\n  ✗ Falta SEDE_ID en el entorno.\n');
    process.exit(1);
  }

  if (process.argv.includes('--purgar')) {
    console.log('\nRetirando los datos de demostración…\n');
    const r = await purgarCatalogo(prisma);
    for (const [que, cuantos] of Object.entries(r)) {
      console.log(`  − ${String(cuantos).padStart(5)}  ${que}`);
    }
    console.log(`
  Los pacientes que se registraron por su cuenta NO se tocaron: solo se borran
  los que llevan la marca DEMO.

  Sus citas sí, si estaban con un médico de demostración: al retirar el prestador
  la cita no puede sobrevivir. Avisa a quien haya agendado durante las pruebas.
`);
    return;
  }

  if (!(await prisma.sede.findUnique({ where: { id: sedeId } }))) {
    console.error(`\n  ✗ No existe la sede "${sedeId}". Ejecuta antes:\n      node apps/api/dist/cli/alta-inicial.js --email … --nombre …\n`);
    process.exit(1);
  }

  const cuantosContactos = Number(argumento('contactos') ?? 200);
  console.log(`\nCargando el catálogo de demostración en la sede ${sedeId}…\n`);

  const r = await cargarCatalogo(prisma, sedeId, { contactos: cuantosContactos });
  for (const [que, cuantos] of Object.entries(r)) {
    console.log(`  + ${String(cuantos).padStart(5)}  ${que}`);
  }

  console.log(`
  ────────────────────────────────────────────────────────────
    Estos datos son DE PRUEBA, no del cliente.

    · Los pacientes llevan la condición «DEMO», visible en su ficha.
    · Los contactos se llaman «Contacto Demo NNNN».
    · Las agendas de especialistas se calcularon desde hoy, así que
      hay cupos esta semana y las dos siguientes.

    Para retirarlo todo cuando lleguen los datos reales:
      node apps/api/dist/cli/datos-demo.js --purgar

    Ojo: la purga borra también las citas agendadas contra estos médicos,
    aunque las haya hecho una persona real durante las pruebas.
  ────────────────────────────────────────────────────────────
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
