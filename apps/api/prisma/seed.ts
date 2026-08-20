/**
 * Seed de desarrollo · datos del prototipo index_v2.html
 * 3 médicos generales (grupo de balanceo RN-02) + especialistas, servicios con tipos y cupos.
 * Idempotente: se puede correr varias veces sin duplicar.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();
const SEDE_ID = 'cdc-oriente';

const ARGON2: argon2.Options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

/** Solo para desarrollo. En staging/prod las credenciales se crean aparte. */
const PASSWORD_DEV = 'Provivir2026!';

const SERVICIOS: Prisma.ServicioCreateInput[] = [
  { id: 'mg',   nombre: 'Medicina general · Consulta', categoria: 'Medicina general', tipo: 'general',       duracionMin: 15,  cupos: 1 },
  // RN-01.2 · el control no tiene costo
  { id: 'ctrl', nombre: 'Medicina general · Control',  categoria: 'Medicina general', tipo: 'control',       duracionMin: 10,  cupos: 1, politicaCosto: 'sin_costo' },
  { id: 'gin',  nombre: 'Ginecología',                 categoria: 'Especialista',     tipo: 'general',       duracionMin: 20,  cupos: 1 },
  { id: 'der',  nombre: 'Dermatología · Consulta',     categoria: 'Especialista',     tipo: 'general',       duracionMin: 20,  cupos: 1 },
  // RN-04.3 · procedimiento con duración propia
  { id: 'derp', nombre: 'Procedimiento dermatológico', categoria: 'Procedimiento',    tipo: 'procedimiento', duracionMin: 120, cupos: 1 },
  { id: 'nut',  nombre: 'Nutrición',                   categoria: 'Especialista',     tipo: 'general',       duracionMin: 30,  cupos: 1 },
  { id: 'vitc', nombre: 'Suero de vitamina C',         categoria: 'Procedimiento',    tipo: 'procedimiento', duracionMin: 15,  cupos: 1 },
  { id: 'eco',  nombre: 'Ecografía',                   categoria: 'Diagnóstico',      tipo: 'examen',        duracionMin: 20,  cupos: 1, requiereOrden: true },
  // RN-04.4 · el Doppler ocupa dos cupos
  { id: 'ecod', nombre: 'Ecografía Doppler',           categoria: 'Diagnóstico',      tipo: 'examen',        duracionMin: 40,  cupos: 2, requiereOrden: true },
  { id: 'lab',  nombre: 'Laboratorio clínico',         categoria: 'Laboratorio',      tipo: 'examen',        duracionMin: 10,  cupos: 1, requiereOrden: true },
];

interface SeedPrestador {
  id: string; nombre: string; especialidad: string; grupoBalanceo: boolean;
  vinculacion: string; consultorio: string; ventanaControlDias?: number;
  duraciones: Record<string, number>;
}

const PRESTADORES: SeedPrestador[] = [
  // RN-02.1 · los tres de medicina general son el único grupo que balancea
  { id: 'ao', nombre: 'Dr. Andrés Osorio',   especialidad: 'Medicina General', grupoBalanceo: true,  vinculacion: 'Interno', consultorio: 'Consultorio 1', ventanaControlDias: 10, duraciones: { mg: 15, ctrl: 10 } },
  { id: 'pr', nombre: 'Dra. Pamela Ríos',    especialidad: 'Medicina General', grupoBalanceo: true,  vinculacion: 'Interno', consultorio: 'Consultorio 2', ventanaControlDias: 8,  duraciones: { mg: 15, ctrl: 10 } },
  { id: 'jo', nombre: 'Dr. Jaime Ortiz',     especialidad: 'Medicina General', grupoBalanceo: true,  vinculacion: 'Interno', consultorio: 'Consultorio 4', ventanaControlDias: 30, duraciones: { mg: 15, ctrl: 10, vitc: 15 } },
  { id: 'md', nombre: 'Dra. Marcela Duarte', especialidad: 'Ginecología',      grupoBalanceo: false, vinculacion: 'Interno', consultorio: 'Consultorio 5', duraciones: { gin: 20 } },
  { id: 'lp', nombre: 'Dra. Liliana Peña',   especialidad: 'Dermatología',     grupoBalanceo: false, vinculacion: 'Externo', consultorio: 'Consultorio 6', duraciones: { der: 20, derp: 120 } },
  { id: 'is', nombre: 'Dr. Iván Salas',      especialidad: 'Nutrición',        grupoBalanceo: false, vinculacion: 'Externo', consultorio: 'Consultorio 7', duraciones: { nut: 30 } },
  { id: 'ec', nombre: 'Ecografías CDC',      especialidad: 'Imágenes',         grupoBalanceo: false, vinculacion: 'Interno', consultorio: 'Sala de Ecografía',   duraciones: { eco: 20, ecod: 40 } },
  { id: 'ln', nombre: 'Laboratorio CDC',     especialidad: 'Laboratorio',      grupoBalanceo: false, vinculacion: 'Interno', consultorio: 'Toma de Muestras 1',  duraciones: { lab: 10 } },
];

const LUN_VIE = [1, 2, 3, 4, 5];
const LUN_SAB = [1, 2, 3, 4, 5, 6];

const AGENDAS = [
  { prestadorId: 'ao', modo: 'semanal' as const, diasSemana: LUN_SAB, horaIni: '08:00', horaFin: '12:00', slotMin: 15, servicioId: 'mg',  consultorio: 'Consultorio 1' },
  { prestadorId: 'pr', modo: 'semanal' as const, diasSemana: LUN_VIE, horaIni: '08:00', horaFin: '12:00', slotMin: 15, servicioId: 'mg',  consultorio: 'Consultorio 2' },
  { prestadorId: 'jo', modo: 'semanal' as const, diasSemana: LUN_VIE, horaIni: '14:00', horaFin: '18:00', slotMin: 15, servicioId: 'mg',  consultorio: 'Consultorio 4' },
  { prestadorId: 'md', modo: 'semanal' as const, diasSemana: LUN_SAB, horaIni: '08:00', horaFin: '16:00', slotMin: 20, servicioId: 'gin', consultorio: 'Consultorio 5' },
  // RN-04.1 · los especialistas externos atienden por fechas puntuales
  { prestadorId: 'lp', modo: 'calendario' as const, diasSemana: [], fecha: '2026-08-21', horaIni: '10:00', horaFin: '13:00', slotMin: 20, servicioId: 'der', consultorio: 'Consultorio 6' },
  { prestadorId: 'is', modo: 'calendario' as const, diasSemana: [], fecha: '2026-08-22', horaIni: '08:00', horaFin: '12:00', slotMin: 30, servicioId: 'nut', consultorio: 'Consultorio 7' },
  { prestadorId: 'ec', modo: 'semanal' as const, diasSemana: LUN_SAB, horaIni: '07:00', horaFin: '12:00', slotMin: 20, servicioId: 'eco', consultorio: 'Sala de Ecografía' },
  { prestadorId: 'ln', modo: 'semanal' as const, diasSemana: LUN_SAB, horaIni: '07:00', horaFin: '11:00', slotMin: 10, servicioId: 'lab', consultorio: 'Toma de Muestras 1' },
];

interface SeedPaciente {
  doc: string; nombres: string; apellidos: string; tel: string;
  correo?: string; condiciones?: string[]; origen: 'carga' | 'whatsapp' | 'autoagendamiento';
  hist: Array<{ f: string; s: string }>;
}

const PACIENTES: SeedPaciente[] = [
  { doc: '12345678', nombres: 'Carlos', apellidos: 'Mora', tel: '+57 300 111 1111', origen: 'carga',
    hist: [{ f: '2026-07-30', s: 'Medicina general · Consulta' }, { f: '2026-06-14', s: 'Laboratorio · Hemograma' }, { f: '2026-02-02', s: 'Medicina general · Consulta' }] },
  { doc: '23456789', nombres: 'Ana', apellidos: 'Torres', tel: '+57 300 222 2222', condiciones: ['Adulto mayor'], origen: 'carga',
    hist: [{ f: '2026-08-12', s: 'Medicina general · Consulta' }, { f: '2026-08-01', s: 'Laboratorio · Glicemia' }, { f: '2026-05-20', s: 'Ecografía' }, { f: '2026-03-11', s: 'Medicina general · Consulta' }, { f: '2025-12-02', s: 'Nutrición' }] },
  { doc: '34567890', nombres: 'Pedro', apellidos: 'Gómez', tel: '+57 300 333 3333', origen: 'carga',
    hist: [{ f: '2026-08-10', s: 'Dermatología · Consulta' }] },
  { doc: '45678901', nombres: 'María', apellidos: 'López', tel: '+57 300 444 4444', correo: 'maria.lopez@mail.com', condiciones: ['Movilidad reducida'], origen: 'carga',
    hist: [{ f: '2026-07-22', s: 'Ginecología' }, { f: '2026-07-22', s: 'Laboratorio · Perfil lipídico' }, { f: '2026-04-15', s: 'Ginecología' }] },
  { doc: '56789012', nombres: 'Jorge', apellidos: 'Patiño', tel: '+57 301 555 5555', origen: 'whatsapp',
    hist: [{ f: '2026-08-05', s: 'Medicina general · Consulta' }, { f: '2026-08-11', s: 'Medicina general · Control' }] },
  { doc: '67890123', nombres: 'Lucía', apellidos: 'Mendoza', tel: '+57 302 666 6666', condiciones: ['Embarazo'], origen: 'autoagendamiento',
    hist: [{ f: '2026-08-14', s: 'Ecografía Doppler' }, { f: '2026-07-01', s: 'Ginecología' }] },
  { doc: '78901234', nombres: 'Rosa', apellidos: 'Quintero', tel: '+57 300 777 7777', condiciones: ['Adulto mayor'], origen: 'carga',
    hist: [{ f: '2026-08-06', s: 'Laboratorio · TSH' }, { f: '2026-08-06', s: 'Laboratorio · Hemograma' }, { f: '2026-06-30', s: 'Medicina general · Consulta' }] },
];

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

  for (const s of SERVICIOS) {
    await prisma.servicio.upsert({ where: { id: s.id }, update: s, create: s });
  }
  console.log(`  servicios: ${SERVICIOS.length} (Doppler = ${SERVICIOS.find((s) => s.id === 'ecod')?.cupos} cupos)`);

  for (const p of PRESTADORES) {
    await prisma.prestador.upsert({
      where: { id: p.id },
      update: { nombre: p.nombre, especialidad: p.especialidad, grupoBalanceo: p.grupoBalanceo, consultorio: p.consultorio },
      create: { id: p.id, nombre: p.nombre, especialidad: p.especialidad, grupoBalanceo: p.grupoBalanceo, vinculacion: p.vinculacion, consultorio: p.consultorio, sedeId: SEDE_ID },
    });

    // RN-01.4 · duración por prestador y tipo de servicio
    for (const [servicioId, duracionMin] of Object.entries(p.duraciones)) {
      await prisma.prestadorServicio.upsert({
        where: { prestadorId_servicioId: { prestadorId: p.id, servicioId } },
        update: { duracionMin },
        create: { prestadorId: p.id, servicioId, duracionMin },
      });
    }

    // RN-01.3 · la ventana de control es por prestador, no global
    if (p.ventanaControlDias !== undefined) {
      await prisma.prestadorConfig.upsert({
        where: { prestadorId: p.id },
        update: { ventanaControlDias: p.ventanaControlDias },
        create: { prestadorId: p.id, ventanaControlDias: p.ventanaControlDias },
      });
    }
  }
  const mg = PRESTADORES.filter((p) => p.grupoBalanceo).length;
  console.log(`  prestadores: ${PRESTADORES.length} (${mg} en grupo de balanceo de medicina general)`);

  await prisma.agenda.deleteMany({});
  for (const a of AGENDAS) {
    await prisma.agenda.create({
      data: {
        prestadorId: a.prestadorId, modo: a.modo, diasSemana: a.diasSemana,
        fecha: a.fecha ? new Date(`${a.fecha}T00:00:00Z`) : null,
        horaIni: a.horaIni, horaFin: a.horaFin, slotMin: a.slotMin,
        servicioId: a.servicioId, consultorio: a.consultorio, sedeId: SEDE_ID,
      },
    });
  }
  console.log(`  agendas: ${AGENDAS.length}`);

  for (const p of PACIENTES) {
    const paciente = await prisma.paciente.upsert({
      where: { documento: p.doc },
      update: { telefono: p.tel, whatsapp: p.tel, correo: p.correo ?? null, condiciones: p.condiciones ?? [] },
      create: {
        documento: p.doc, nombres: p.nombres, apellidos: p.apellidos,
        telefono: p.tel, whatsapp: p.tel, correo: p.correo ?? null,
        condiciones: p.condiciones ?? [], origen: p.origen, sedeId: SEDE_ID,
      },
    });

    // RN-12.4 · historial OPERATIVO de servicios, sin datos clínicos
    await prisma.historialServicio.deleteMany({ where: { pacienteId: paciente.id } });
    await prisma.historialServicio.createMany({
      data: p.hist.map((h) => ({ pacienteId: paciente.id, fecha: new Date(`${h.f}T00:00:00Z`), servicioTexto: h.s })),
    });
  }
  console.log(`  pacientes: ${PACIENTES.length}`);

  await prisma.pantalla.deleteMany({});
  await prisma.pantalla.createMany({
    data: [
      { nombre: 'Pantalla 1 · Sala Medicina General', servicios: ['mg', 'ctrl', 'vitc'], turnosVisibles: 4, sonido: true, media: true, canalYoutube: 'https://youtube.com/@NoticiasCaracol/live', videosPromo: ['Video institucional Grupo Provivir · Servicios 2026'], intervaloInstitucionalMin: 10, mensaje: 'La atención es únicamente con cita previa. Agenda por WhatsApp o en grupoprovivir.com.', sedeId: SEDE_ID },
      { nombre: 'Pantalla 2 · Sala Especialistas y Ecografía', servicios: ['gin', 'der', 'derp', 'nut', 'eco', 'ecod'], turnosVisibles: 4, sonido: true, media: true, canalYoutube: 'https://youtube.com/@NoticiasCaracol/live', videosPromo: ['Video promocional · Sueros y procedimientos'], intervaloInstitucionalMin: 10, mensaje: 'Para tu ecografía, recuerda las indicaciones de preparación.', sedeId: SEDE_ID },
      { nombre: 'Pantalla 3 · Sala Laboratorio', servicios: ['lab'], turnosVisibles: 6, sonido: false, media: false, mensaje: 'Para toma de muestras, recuerda el ayuno indicado en tu orden.', sedeId: SEDE_ID },
    ],
  });
  console.log('  pantallas: 3');

  for (const c of CONFIGURACION) {
    await prisma.configuracion.upsert({ where: { clave: c.clave }, update: { descripcion: c.descripcion }, create: c });
  }
  console.log(`  configuración: ${CONFIGURACION.length} parámetros`);

  const hash = await argon2.hash(PASSWORD_DEV, ARGON2);
  const USUARIOS = [
    { nombre: 'John Mendoza',   email: 'admin@provivir.local',      rol: 'admin' as const,     prestadorId: null },
    { nombre: 'Paula Asistente', email: 'asistente@provivir.local',  rol: 'asistente' as const, prestadorId: null },
    { nombre: 'Dr. Andrés Osorio', email: 'osorio@provivir.local',   rol: 'prestador' as const, prestadorId: 'ao' },
    { nombre: 'Pantalla Sala 1', email: 'pantalla@provivir.local',   rol: 'pantalla' as const,  prestadorId: null },
  ];
  for (const u of USUARIOS) {
    await prisma.usuario.upsert({
      where: { email: u.email },
      update: { nombre: u.nombre, rol: u.rol, hashPassword: hash },
      create: { ...u, hashPassword: hash, sedeId: SEDE_ID },
    });
  }
  console.log(`  usuarios: ${USUARIOS.length} (uno por rol) · password dev: ${PASSWORD_DEV}`);

  console.log('Seed completo.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
