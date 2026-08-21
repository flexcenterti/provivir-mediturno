/**
 * Borra los datos que deja la prueba de carga (documentos con prefijo 88).
 * Se ejecuta a mano: nunca de forma automática, para no borrar nada por accidente.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIJO = '88';

async function main(): Promise<void> {
  const turnos = await prisma.turno.deleteMany({
    where: { cita: { paciente: { documento: { startsWith: PREFIJO } } } },
  });
  const citas = await prisma.cita.deleteMany({
    where: { paciente: { documento: { startsWith: PREFIJO } } },
  });
  const historial = await prisma.historialServicio.deleteMany({
    where: { paciente: { documento: { startsWith: PREFIJO } } },
  });
  const pacientes = await prisma.paciente.deleteMany({
    where: { documento: { startsWith: PREFIJO } },
  });

  console.log(
    `Limpieza de carga: ${pacientes.count} pacientes, ${citas.count} citas, ` +
    `${turnos.count} turnos, ${historial.count} historiales.`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
