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
import { CONFIGURACION_BASE } from '../src/cli/configuracion.base';

const prisma = new PrismaClient();
const SEDE_ID = 'cdc-oriente';

/** Solo para desarrollo. En staging/prod las credenciales se crean aparte. */
const PASSWORD_DEV = 'Provivir2026!';


async function main(): Promise<void> {
  console.log('Seed · Grupo Provivir (CDC Oriente)');

  // D1 · sede única
  await prisma.sede.upsert({
    where: { id: SEDE_ID },
    update: {},
    create: { id: SEDE_ID, nombre: 'CDC Oriente', direccion: 'Grupo Provivir · Cali', waNumero: '+57 315 000 0001', horario: '7:00–18:00' },
  });

  for (const c of CONFIGURACION_BASE) {
    await prisma.configuracion.upsert({ where: { clave: c.clave }, update: { descripcion: c.descripcion }, create: c });
  }
  console.log(`  configuración: ${CONFIGURACION_BASE.length} parámetros`);

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
      // `prestadorId` también al actualizar: sin él, re-sembrar sobre un usuario que
      // ya existía sin ficha lo dejaba igual — rol médico y ninguna cola que mostrar
      // (RN-06.2). Misma clase de fallo que el que había en la API.
      update: {
        nombre: u.nombre, rol: u.rol, hashPassword: hash, activo: true,
        prestadorId: u.prestadorId, perfilId: perfiles.get(PERFIL_DE_ROL[u.rol]),
      },
      create: { ...u, hashPassword: hash, sedeId: SEDE_ID, perfilId: perfiles.get(PERFIL_DE_ROL[u.rol]) },
    });
  }
  console.log(`  perfiles: ${perfiles.size} · usuarios: ${USUARIOS.length} · password dev: ${PASSWORD_DEV}`);

  await sembrarConversaciones();

  console.log('Seed completo.');
}

/**
 * Conversaciones de WhatsApp para poder probar la bandeja.
 *
 * Hasta la fase 18 el seed no creaba ni una, y por eso ninguna prueba de navegador
 * abría un hilo: la lista siempre estaba vacía y solo se podía comprobar el cromo.
 *
 * Los tiempos son RELATIVOS a ahora, no fechas fijas: con fechas, la conversación que
 * hoy lleva 90 minutos esperando lleva semanas el mes que viene, y las pruebas de la
 * ventana de 24 h dejan de significar nada.
 *
 * Idempotente por ids fijos, como el resto del seed.
 */
async function sembrarConversaciones(): Promise<void> {
  const ahora = Date.now();
  const hace = (min: number) => new Date(ahora - min * 60_000);

  /*
   * Los ÚLTIMOS por documento, no los primeros: los primeros los usan las pruebas de
   * citas y del mostrador, y una de ellas comprueba justamente que a ese paciente
   * «nunca le llegó nada por WhatsApp». Darle conversación aquí la rompía.
   */
  const pacientes = await prisma.paciente.findMany({ take: 4, orderBy: { documento: 'desc' } });
  if (pacientes.length < 4) { console.log('  conversaciones: omitidas (faltan pacientes)'); return; }
  const asistente = await prisma.usuario.findUnique({ where: { email: 'asistente@provivir.local' } });

  const hilos = [
    {
      id: 'e2e-conv-1', paciente: pacientes[0]!, prioridad: 'alta' as const,
      estado: 'escalada' as const, escalada: true, escaladaTs: hace(90), resueltaTs: null,
      motivo: 'El paciente solicitó hablar con una persona',
      // Un mensaje de ayer y dos de hoy: así el chat tiene que pintar el separador.
      mensajes: [
        { direccion: 'entrante' as const, contenido: 'Buenas, necesito cambiar mi cita', ts: hace(60 * 26) },
        { direccion: 'saliente' as const, contenido: 'Con gusto, ¿para cuándo la quieres?', ts: hace(95), autor: null },
        { direccion: 'entrante' as const, contenido: 'Para el jueves si se puede', ts: hace(10) },
      ],
    },
    {
      id: 'e2e-conv-2', paciente: pacientes[1]!, prioridad: 'media' as const,
      estado: 'escalada' as const, escalada: true, escaladaTs: hace(60 * 96), resueltaTs: null,
      motivo: 'Adjunto de tipo imagen que la plataforma no interpreta',
      // Cuatro días sin escribir: la ventana de 24 h de Meta está cerrada.
      mensajes: [
        { direccion: 'entrante' as const, contenido: 'Les mando la orden médica', ts: hace(60 * 96) },
      ],
    },
    {
      id: 'e2e-conv-3', paciente: pacientes[2]!, prioridad: 'baja' as const,
      estado: 'resuelta' as const, escalada: true, escaladaTs: hace(60 * 50), resueltaTs: hace(60 * 48),
      motivo: 'Consulta sobre horarios', reaperturas: 1, reabiertaTs: hace(60 * 49),
      mensajes: [
        { direccion: 'entrante' as const, contenido: '¿A qué hora abren los sábados?', ts: hace(60 * 51) },
        { direccion: 'saliente' as const, contenido: 'Abrimos de 7 a 12.', ts: hace(60 * 50), autor: null },
      ],
    },
    {
      id: 'e2e-conv-4', paciente: pacientes[3]!, prioridad: 'baja' as const,
      // La que el bot llevó de punta a punta: no sale en pendientes ni en cerradas.
      estado: 'ia_activa' as const, escalada: false, escaladaTs: null, resueltaTs: null,
      motivo: null,
      mensajes: [
        { direccion: 'entrante' as const, contenido: 'Gracias, quedo atento', ts: hace(60 * 5) },
      ],
    },
  ];

  for (const h of hilos) {
    const datos = {
      telefono: h.paciente.whatsapp ?? h.paciente.telefono ?? `+5730000000${hilos.indexOf(h)}`,
      pacienteId: h.paciente.id, estado: h.estado, prioridad: h.prioridad,
      escalada: h.escalada, escaladaTs: h.escaladaTs, resueltaTs: h.resueltaTs,
      motivo: h.motivo, reaperturas: h.reaperturas ?? 0, reabiertaTs: h.reabiertaTs ?? null,
      sedeId: SEDE_ID,
    };
    await prisma.conversacion.upsert({ where: { id: h.id }, update: datos, create: { id: h.id, ...datos } });

    // Los mensajes se recrean: sus marcas de tiempo son relativas y hay que refrescarlas.
    await prisma.mensaje.deleteMany({ where: { conversacionId: h.id } });
    for (const m of h.mensajes) {
      await prisma.mensaje.create({
        data: {
          conversacionId: h.id, direccion: m.direccion, tipo: 'texto',
          contenido: m.contenido, ts: m.ts,
          autorId: m.direccion === 'saliente' ? ('autor' in m ? m.autor : asistente?.id) ?? null : null,
        },
      });
    }
  }

  // RN-09.9.8 · un interesado con su secuencia a medias, para el chip de la bandeja.
  await prisma.seguimiento.deleteMany({ where: { conversacionId: 'e2e-conv-4' } });
  await prisma.seguimiento.createMany({
    data: [
      {
        conversacionId: 'e2e-conv-4', pacienteId: pacientes[3]!.id,
        telefono: hilos[3]!.paciente.whatsapp ?? '+573000000003', servicioId: 'mg',
        paso: 'seguimiento_1', estado: 'enviado',
        programadoPara: hace(60 * 3), enviadoEn: hace(60 * 3), sedeId: SEDE_ID,
      },
      {
        conversacionId: 'e2e-conv-4', pacienteId: pacientes[3]!.id,
        telefono: hilos[3]!.paciente.whatsapp ?? '+573000000003', servicioId: 'mg',
        paso: 'seguimiento_2', estado: 'programado',
        programadoPara: new Date(ahora + 42 * 60_000), sedeId: SEDE_ID,
      },
    ],
  });

  console.log(`  conversaciones: ${hilos.length} · 1 interesado en seguimiento`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
