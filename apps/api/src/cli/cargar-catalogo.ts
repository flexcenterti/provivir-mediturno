/**
 * Carga el catálogo REAL de la clínica: profesionales, servicios y jornadas.
 *
 *   node apps/api/dist/cli/cargar-catalogo.js
 *   node apps/api/dist/cli/cargar-catalogo.js --festivos 2026
 *
 * En desarrollo:
 *   npx tsx apps/api/src/cli/cargar-catalogo.ts
 *
 * Los datos viven en `catalogo.clinica.ts`, que es la fuente de verdad del horario.
 * Cuando la clínica cambie una jornada se edita ese archivo y se vuelve a ejecutar
 * esto: el cambio queda en git y se aplica igual en desarrollo y en producción.
 *
 * ⚠ Servicios y prestadores se actualizan sin pisar nada más (upsert), pero las
 * AGENDAS se reemplazan en bloque: reejecutarlo descarta los ajustes de horario que
 * se hayan hecho a mano desde el backoffice para estos profesionales.
 *
 * Requiere que la sede exista: córrase antes alta-inicial.js.
 */
import { PrismaClient } from '@prisma/client';
import { festivosColombia } from '@provivir/shared';
import { cargarCatalogoClinica } from './catalogo.clinica';

const prisma = new PrismaClient();

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** RN-06.5 · sin esto el sistema ofrece cupos el 25 de diciembre. */
async function cargarFestivos(sedeId: string, anio: number): Promise<number> {
  const festivos = festivosColombia(anio);
  const r = await prisma.diaNoLaborable.createMany({
    data: festivos.map((f) => ({
      fecha: new Date(`${f.fecha}T00:00:00Z`),
      motivo: f.motivo,
      tipo: 'festivo' as const,
      sedeId,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

async function main(): Promise<void> {
  const sedeId = process.env.SEDE_ID;
  if (!sedeId) {
    console.error('\n  ✗ Falta SEDE_ID en el entorno.\n');
    process.exit(1);
  }

  if (!(await prisma.sede.findUnique({ where: { id: sedeId } }))) {
    console.error(
      `\n  ✗ No existe la sede "${sedeId}". Ejecuta antes:\n` +
      '      node apps/api/dist/cli/alta-inicial.js --email … --nombre …\n',
    );
    process.exit(1);
  }

  console.log(`\nCargando el catálogo de la clínica en la sede ${sedeId}…\n`);
  const r = await cargarCatalogoClinica(prisma, sedeId);
  for (const [que, cuantos] of Object.entries(r)) {
    console.log(`  + ${String(cuantos).padStart(5)}  ${que}`);
  }

  const anio = argumento('festivos');
  if (anio !== undefined) {
    const nuevos = await cargarFestivos(sedeId, Number(anio));
    console.log(`  + ${String(nuevos).padStart(5)}  festivos de ${anio}`);
  }

  console.log(`
  ────────────────────────────────────────────────────────────

  Quedó pendiente, porque la clínica no lo ha definido:

    · los CONSULTORIOS de cada profesional — se rellenan en
      Backoffice → Catálogo → Prestadores, y son el dato que se
      le dice al paciente al llamarlo en sala;
    · la jornada de MEDICINA OCUPACIONAL de Ingrit Perea: el
      servicio existe y ella está habilitada, pero sin franja
      nadie puede agendarlo.

  ${anio === undefined ? 'Los FESTIVOS no se cargaron. Sin ellos el sistema ofrece\n  cupos el 25 de diciembre: usa --festivos <año>, o impórtalos\n  desde Backoffice → Administración → Días no laborables.' : 'Los festivos del año siguiente se cargan desde\n  Backoffice → Administración → Días no laborables.'}
`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
