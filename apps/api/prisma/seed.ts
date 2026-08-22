/**
 * Seed de desarrollo · Grupo Provivir (CDC Oriente).
 *
 * El catálogo sale de src/cli/catalogo.demo.ts, la misma fuente que usa el
 * cargador de demostración de producción: dos catálogos que se desincronizan son
 * peor que no tener seed.
 *
 * Lo único propio de aquí son los usuarios con contraseña conocida, que es
 * justamente lo que impide correr esto en producción.
 *
 * Idempotente: se puede correr varias veces sin duplicar.
 */
import { PrismaClient } from '@prisma/client';
import { hashearPassword } from '../src/auth/argon2.opciones';
import { cargarCatalogo } from '../src/cli/catalogo.demo';
import { asegurarPerfilesBase, PERFIL_DE_ROL } from '../src/cli/usuarios.comun';

const prisma = new PrismaClient();
const SEDE_ID = 'cdc-oriente';

/** Solo para desarrollo. En staging/prod las credenciales se crean aparte. */
const PASSWORD_DEV = 'Provivir2026!';

/** Arquitectura §9 · parámetros de reglas fuera del código */
const CONFIGURACION = [
  { clave: 'hueco_max_min', valor: '0', descripcion: 'RN-03.2 · Hueco máximo tolerado al recomendar cupos. 0 = compactar al máximo.' },
  { clave: 'ventana_control_dias_defecto', valor: '10', descripcion: 'RN-01.3 · Ventana de control por defecto si el prestador no define la suya.' },
  { clave: 'kiosko_activo', valor: 'false', descripcion: 'D3 · El kiosko queda construido pero apagado.' },
  { clave: 'umbral_confianza_ia', valor: '70', descripcion: 'RN-08 · Bajo este umbral la IA escala a la asistente.' },
  { clave: 'intervalo_institucional_min', valor: '10', descripcion: 'RN-11.2 · Cada cuántos minutos se interrumpe el canal para el video institucional.' },
  { clave: 'anticipacion_llegada_min', valor: '15', descripcion: 'Minutos de anticipación con que se permite registrar llegada.' },
  { clave: 'tolerancia_retraso_min', valor: '10', descripcion: 'Tolerancia de retraso antes de degradar la prioridad en cola.' },
];

async function main(): Promise<void> {
  console.log('Seed · Grupo Provivir (CDC Oriente)');

  // D1 · sede única
  await prisma.sede.upsert({
    where: { id: SEDE_ID },
    update: {},
    create: { id: SEDE_ID, nombre: 'CDC Oriente', direccion: 'Grupo Provivir · Cali', waNumero: '+57 315 000 0001', horario: '7:00–18:00' },
  });

  for (const c of CONFIGURACION) {
    await prisma.configuracion.upsert({ where: { clave: c.clave }, update: { descripcion: c.descripcion }, create: c });
  }
  console.log(`  configuración: ${CONFIGURACION.length} parámetros`);

  // En desarrollo los pacientes NO se marcan como demo: las pruebas e2e y el
  // trabajo diario los tratan como si fueran reales, que es el punto del seed.
  const r = await cargarCatalogo(prisma, SEDE_ID, { contactos: 50, marcarDemo: false });
  console.log(`  servicios: ${r.servicios} · prestadores: ${r.prestadores} · agendas: ${r.agendas}`);
  console.log(`  pacientes: ${r.pacientes} · pantallas: ${r.pantallas} · contactos: ${r.contactos}`);

  await asegurarPerfilesBase(prisma, SEDE_ID);
  const perfiles = new Map((await prisma.perfil.findMany()).map((p) => [p.nombre, p.id]));

  const hash = await hashearPassword(PASSWORD_DEV);
  const USUARIOS = [
    { nombre: 'John Mendoza',   email: 'admin@provivir.local',      rol: 'admin' as const,     prestadorId: null },
    { nombre: 'Paula Asistente', email: 'asistente@provivir.local',  rol: 'asistente' as const, prestadorId: null },
    { nombre: 'Dr. Andrés Osorio', email: 'osorio@provivir.local',   rol: 'prestador' as const, prestadorId: 'ao' },
    { nombre: 'Pantalla Sala 1', email: 'pantalla@provivir.local',   rol: 'pantalla' as const,  prestadorId: null },
  ];
  for (const u of USUARIOS) {
    await prisma.usuario.upsert({
      where: { email: u.email },
      update: { nombre: u.nombre, rol: u.rol, hashPassword: hash, perfilId: perfiles.get(PERFIL_DE_ROL[u.rol]) },
      create: { ...u, hashPassword: hash, sedeId: SEDE_ID, perfilId: perfiles.get(PERFIL_DE_ROL[u.rol]) },
    });
  }
  console.log(`  perfiles: ${perfiles.size} · usuarios: ${USUARIOS.length} · password dev: ${PASSWORD_DEV}`);

  console.log('Seed completo.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
