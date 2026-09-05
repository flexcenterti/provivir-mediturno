import type { PrismaClient } from '@prisma/client';

/**
 * Catálogo REAL de la clínica · entregado por Gerencia (agosto de 2026).
 *
 * Este archivo es la fuente de verdad de quién atiende, qué atiende y en qué horario.
 * Cuando cambie una jornada se edita aquí y se vuelve a ejecutar el cargador: así el
 * horario de la clínica queda en git, con su historial, en vez de repartido en
 * formularios que nadie puede auditar.
 *
 * No se carga desde el backoffice porque son ~26 franjas de agenda y teclearlas a mano
 * es lento y no queda auditado en un sitio revisable.
 *
 * (Desde la fase 21 la interfaz **sí** corrige y retira agendas —RN-06.6—, así que una
 * franja mal tecleada ya no se queda para siempre. Lo que sigue siendo cierto es lo de
 * abajo: reejecutar esto descarta los ajustes hechos a mano.)
 *
 * Lo que NO está aquí, deliberadamente:
 *   · consultorios — el cliente no los envió; se rellenan desde el backoffice
 *   · la habilitación de Ingrit Perea en Medicina Ocupacional — el servicio existe,
 *     pero la clínica no definió su jornada y habilitarla la ofrecería en todas sus
 *     horas de medicina general. Ver la nota junto a su ficha.
 *   · el resto del personal del archivo de Gerencia (Hernandez Amaris, Romero Ramirez,
 *     Exámenes Cardiovasculares…): el cliente pidió «iniciamos con estos servicios».
 */

/** Nota del cliente: «no atendemos domingos ni festivos». */
const LUN_VIE = [1, 2, 3, 4, 5];
const SABADO = [6];

interface ServicioClinica {
  id: string; nombre: string; categoria: string;
  tipo: 'general' | 'control' | 'procedimiento' | 'examen';
  duracionMin: number; requiereOrden: boolean;
  /**
   * RN-01.2 · Qué se le cobra. **Obligatorio a propósito**, aunque la base tenga
   * default: la primera carga no lo declaró en ninguno de los 21 servicios y todos
   * cayeron en `costo_pleno`, incluido el control — que por regla no tiene costo.
   * No se notó durante meses porque el campo no decidía nada; desde RN-07.6 el
   * mostrador lo lee. Que sea obligatorio es lo que impide que el próximo servicio
   * nazca con la política invisible.
   */
  politicaCosto: 'sin_costo' | 'costo_pleno';
  /** RN-13.9 · false = el bot lo describe pero no ofrece agendarlo por chat. */
  agendable?: boolean;
}

/**
 * `mg` ya existe en el catálogo y se reutiliza tal cual: los cinco médicos generales
 * comparten servicio y solo cambia la duración de cada uno (RN-01.4).
 */
export const SERVICIOS: ServicioClinica[] = [
  { id: 'mg',   nombre: 'Medicina general · Consulta', categoria: 'Medicina general', tipo: 'general', duracionMin: 15, requiereOrden: false, politicaCosto: 'costo_pleno' },
  // Sin jornada definida por la clínica: existe en el catálogo y el bot puede
  // describirlo, pero todavía no se agenda. Ver la nota en Ingrit Perea.
  { id: 'mocu', nombre: 'Medicina ocupacional',        categoria: 'Especialista',     tipo: 'general', duracionMin: 20, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false },
  { id: 'mest', nombre: 'Medicina estética',           categoria: 'Especialista',     tipo: 'general', duracionMin: 15, requiereOrden: false, politicaCosto: 'costo_pleno' },
  { id: 'mint', nombre: 'Medicina interna',            categoria: 'Especialista',     tipo: 'general', duracionMin: 30, requiereOrden: false, politicaCosto: 'costo_pleno' },
  { id: 'odo',  nombre: 'Odontología adultos',         categoria: 'Especialista',     tipo: 'general', duracionMin: 30, requiereOrden: false, politicaCosto: 'costo_pleno' },
  { id: 'otr',  nombre: 'Otorrinolaringología',        categoria: 'Especialista',     tipo: 'general', duracionMin: 15, requiereOrden: false, politicaCosto: 'costo_pleno' },
  { id: 'psi',  nombre: 'Psicología',                  categoria: 'Especialista',     tipo: 'general', duracionMin: 60, requiereOrden: false, politicaCosto: 'costo_pleno' },

  /*
   * RN-04.7 · Lo que NO se agenda solo.
   *
   * El paciente los ve en el portal y el bot los describe, pero para agendarlos hay
   * que hablar con una asistente. Son de dos clases:
   *
   *   · servicios que la clínica coordina a mano (laboratorio, rayos X, droguería,
   *     valoración odontológica, ecografías);
   *   · el control de medicina general, que exige una consulta previa (RN-01) y no
   *     es algo que el paciente pueda resolver solo;
   *   · los especialistas que vienen por fechas sueltas, no en jornada semanal.
   *
   * Duraciones marcadas con «?»: la clínica no las envió. No afectan a nadie mientras
   * no haya agenda, pero conviene confirmarlas antes de que la asistente empiece a
   * agendarlos.
   */
  { id: 'ctrl', nombre: 'Medicina general · Control',   categoria: 'Medicina general', tipo: 'control', duracionMin: 10, requiereOrden: false, politicaCosto: 'sin_costo', agendable: false },
  { id: 'lab',  nombre: 'Laboratorio clínico',          categoria: 'Laboratorio',      tipo: 'examen',  duracionMin: 10, requiereOrden: true,  politicaCosto: 'costo_pleno',  agendable: false },
  { id: 'rx',   nombre: 'Rayos X',                      categoria: 'Diagnóstico',      tipo: 'examen',  duracionMin: 15, requiereOrden: true,  politicaCosto: 'costo_pleno',  agendable: false }, // duración ?
  { id: 'eco',  nombre: 'Ecografía',                    categoria: 'Diagnóstico',      tipo: 'examen',  duracionMin: 20, requiereOrden: true,  politicaCosto: 'costo_pleno',  agendable: false },
  { id: 'ecod', nombre: 'Ecografía Doppler',            categoria: 'Diagnóstico',      tipo: 'examen',  duracionMin: 40, requiereOrden: true,  politicaCosto: 'costo_pleno',  agendable: false },
  { id: 'drog', nombre: 'Droguería',                    categoria: 'Otros',            tipo: 'general', duracionMin: 15, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false }, // duración ?
  { id: 'odov', nombre: 'Valoración odontológica',      categoria: 'Especialista',     tipo: 'general', duracionMin: 20, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false }, // duración ?

  // Especialistas que vienen por fechas sueltas (lista 2 del cliente).
  { id: 'gin',  nombre: 'Ginecología',                  categoria: 'Especialista',     tipo: 'general', duracionMin: 15, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false },
  { id: 'oft',  nombre: 'Oftalmología',                 categoria: 'Especialista',     tipo: 'general', duracionMin: 20, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false },
  { id: 'ped',  nombre: 'Pediatría',                    categoria: 'Especialista',     tipo: 'general', duracionMin: 30, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false },
  { id: 'uro',  nombre: 'Urología',                     categoria: 'Especialista',     tipo: 'general', duracionMin: 15, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false },
  { id: 'opt',  nombre: 'Optometría',                   categoria: 'Especialista',     tipo: 'general', duracionMin: 30, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false },
  { id: 'nut',  nombre: 'Nutrición',                    categoria: 'Especialista',     tipo: 'general', duracionMin: 30, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false },
  { id: 'tra',  nombre: 'Traumatología',                categoria: 'Especialista',     tipo: 'general', duracionMin: 20, requiereOrden: false, politicaCosto: 'costo_pleno', agendable: false },
];

interface PrestadorClinica {
  id: string; nombre: string; especialidad: string; grupoBalanceo: boolean;
  vinculacion: string;
  /** Duración de la consulta por servicio. Gana sobre la del catálogo (RN-01.4). */
  duraciones: Record<string, number>;
}

/**
 * RN-02.1 · solo medicina general balancea. Un especialista se pide por nombre y
 * repartir su carga no tendría sentido: es el único que presta ese servicio.
 */
export const PRESTADORES: PrestadorClinica[] = [
  { id: 'co',   nombre: 'Cesar Osorio',                   especialidad: 'Medicina General',     grupoBalanceo: true,  vinculacion: 'Interno', duraciones: { mg: 15 } },
  { id: 'oo',   nombre: 'Oscar Ortiz',                    especialidad: 'Medicina General',     grupoBalanceo: true,  vinculacion: 'Interno', duraciones: { mg: 15 } },
  /*
   * La clínica la registró también en medicina ocupacional (20 min) pero dejó su
   * horario en blanco, y aquí NO se la habilita todavía — a propósito.
   *
   * El servicio que declara una agenda es informativo, no una restricción: basta
   * habilitarla en `mocu` para que el motor ofrezca medicina ocupacional en TODA su
   * jornada de medicina general, doce horas semanales que nadie autorizó, compitiendo
   * además con sus cupos de consulta.
   *
   * Cuando la clínica defina las horas: añadir `mocu: 20` aquí, su franja en AGENDAS,
   * y quitarle el `agendable: false` al servicio.
   */
  { id: 'ipp',  nombre: 'Ingrit Pamela Perea Casierra',   especialidad: 'Medicina General',     grupoBalanceo: true,  vinculacion: 'Interno', duraciones: { mg: 15 } },
  { id: 'jlr',  nombre: 'Jose Luis Rasjido',              especialidad: 'Medicina General',     grupoBalanceo: true,  vinculacion: 'Interno', duraciones: { mg: 15 } },
  { id: 'krg',  nombre: 'Katherin Rodriguez Gil',         especialidad: 'Medicina General',     grupoBalanceo: true,  vinculacion: 'Interno', duraciones: { mg: 10 } },
  { id: 'evq',  nombre: 'Eva Maria Quiñones',             especialidad: 'Medicina Estética',    grupoBalanceo: false, vinculacion: 'Interno', duraciones: { mest: 15 } },
  { id: 'hamm', nombre: 'Henry Alfonso Maya Makchec',     especialidad: 'Medicina Interna',     grupoBalanceo: false, vinculacion: 'Interno', duraciones: { mint: 30 } },
  { id: 'cam',  nombre: 'Carlos Alberto Moreno',          especialidad: 'Odontología',          grupoBalanceo: false, vinculacion: 'Interno', duraciones: { odo: 30 } },
  { id: 'rebr', nombre: 'Rafael Enrique Barrios Rendon',  especialidad: 'Otorrinolaringología', grupoBalanceo: false, vinculacion: 'Interno', duraciones: { otr: 15 } },
  { id: 'sloq', nombre: 'Sandra Liliana Osorio Quintero', especialidad: 'Psicología',           grupoBalanceo: false, vinculacion: 'Interno', duraciones: { psi: 60 } },

  /*
   * RN-04.7 · Especialistas que vienen por fechas sueltas, no en jornada semanal.
   *
   * Se crean SIN agenda: las fechas que envió la clínica son de agosto y ya pasaron,
   * y cargar fechas caducadas no le sirve a nadie. La asistente las va creando cada
   * mes en Agendas → Programación mensual, conforme la clínica confirma.
   *
   * Hasta que exista esa agenda no se les puede agendar por ningún canal, ni siquiera
   * desde el mostrador: el motor exige franja (RN-06).
   */
  { id: 'ama',  nombre: 'Ana Maria Arias',                especialidad: 'Ginecología',          grupoBalanceo: false, vinculacion: 'Externo', duraciones: { gin: 15 } },
  { id: 'cegg', nombre: 'Carlos Eduardo Gonima Giraldo',  especialidad: 'Oftalmología',         grupoBalanceo: false, vinculacion: 'Externo', duraciones: { oft: 20 } },
  { id: 'cqg',  nombre: 'Catalina Quintero Gomez',        especialidad: 'Pediatría',            grupoBalanceo: false, vinculacion: 'Externo', duraciones: { ped: 30 } },
  { id: 'dfbh', nombre: 'Diego Fernando Barragan Herrera', especialidad: 'Pediatría',           grupoBalanceo: false, vinculacion: 'Externo', duraciones: { ped: 20 } },
  { id: 'dfcc', nombre: 'Diego Fernando Castillo Cobaleda', especialidad: 'Urología',           grupoBalanceo: false, vinculacion: 'Externo', duraciones: { uro: 15 } },
  /*
   * Ojo: comparte servicio (`mint`) con Henry Maya, que sí tiene jornada semanal y sí
   * se agenda solo. Como `agendable` es del servicio y no del prestador, `mint` queda
   * agendable — hoy da igual porque Trujillo no tiene franja, pero el día que la
   * asistente le cargue fechas, esas horas SÍ serán agendables por el portal.
   * Confirmar con la clínica si eso está bien o si hay que separarlos en dos servicios.
   */
  { id: 'jats', nombre: 'Jaime Andres Trujillo Santander', especialidad: 'Medicina Interna',    grupoBalanceo: false, vinculacion: 'Externo', duraciones: { mint: 20 } },
  { id: 'lfvp', nombre: 'Luis Fernando Veloza Pacheco',   especialidad: 'Optometría',           grupoBalanceo: false, vinculacion: 'Externo', duraciones: { opt: 30 } },
  { id: 'lmbg', nombre: 'Luis Miguel Becerra Granados',   especialidad: 'Nutrición',            grupoBalanceo: false, vinculacion: 'Externo', duraciones: { nut: 30 } },
  { id: 'rjd',  nombre: 'Roberto Jose Dulce',             especialidad: 'Traumatología',        grupoBalanceo: false, vinculacion: 'Externo', duraciones: { tra: 20 } },
];

interface AgendaClinica {
  prestadorId: string; diasSemana: number[];
  horaIni: string; horaFin: string; slotMin: number; servicioId: string;
}

/**
 * Las jornadas, tal como las envió la clínica.
 *
 * **Mañana y tarde son dos franjas distintas**, no una sola con hueco: el motor evalúa
 * cada franja por separado y así la hora del almuerzo simplemente no existe como cupo.
 *
 * `slotMin` es cada cuánto arranca un cupo, y NO es lo mismo que la duración de la cita
 * — se fija igual a la duración de cada profesional para que la rejilla quede limpia.
 * Ingrit Perea lleva 15 aunque ocupacional dure 20: una cita de 20 min arranca alineada
 * a la rejilla de 15 y el solapamiento lo corta el motor.
 */
export const AGENDAS: AgendaClinica[] = [
  // ─── Medicina general ───
  // Cesar Osorio · no atiende por la tarde
  { prestadorId: 'co',  diasSemana: LUN_VIE, horaIni: '06:45', horaFin: '11:30', slotMin: 15, servicioId: 'mg' },
  { prestadorId: 'co',  diasSemana: SABADO,  horaIni: '07:00', horaFin: '13:30', slotMin: 15, servicioId: 'mg' },

  { prestadorId: 'oo',  diasSemana: LUN_VIE, horaIni: '07:00', horaFin: '12:00', slotMin: 15, servicioId: 'mg' },
  { prestadorId: 'oo',  diasSemana: LUN_VIE, horaIni: '13:00', horaFin: '16:30', slotMin: 15, servicioId: 'mg' },
  { prestadorId: 'oo',  diasSemana: SABADO,  horaIni: '07:00', horaFin: '13:30', slotMin: 15, servicioId: 'mg' },

  { prestadorId: 'ipp', diasSemana: LUN_VIE, horaIni: '07:00', horaFin: '12:00', slotMin: 15, servicioId: 'mg' },
  { prestadorId: 'ipp', diasSemana: LUN_VIE, horaIni: '13:00', horaFin: '16:30', slotMin: 15, servicioId: 'mg' },
  { prestadorId: 'ipp', diasSemana: SABADO,  horaIni: '07:00', horaFin: '12:00', slotMin: 15, servicioId: 'mg' },

  // Jose Luis Rasjido · entra a las 12:30, media hora antes que el resto
  { prestadorId: 'jlr', diasSemana: LUN_VIE, horaIni: '07:00', horaFin: '12:00', slotMin: 15, servicioId: 'mg' },
  { prestadorId: 'jlr', diasSemana: LUN_VIE, horaIni: '12:30', horaFin: '16:30', slotMin: 15, servicioId: 'mg' },
  { prestadorId: 'jlr', diasSemana: SABADO,  horaIni: '07:00', horaFin: '12:00', slotMin: 15, servicioId: 'mg' },

  // Katherin Rodriguez · la única que atiende de 10 en 10 minutos
  { prestadorId: 'krg', diasSemana: LUN_VIE, horaIni: '07:30', horaFin: '13:00', slotMin: 10, servicioId: 'mg' },
  { prestadorId: 'krg', diasSemana: LUN_VIE, horaIni: '13:30', horaFin: '16:45', slotMin: 10, servicioId: 'mg' },
  { prestadorId: 'krg', diasSemana: SABADO,  horaIni: '07:30', horaFin: '12:00', slotMin: 10, servicioId: 'mg' },

  // ─── Especialistas ───
  // Eva Quiñones · jueves y viernes; la mañana del viernes empieza más tarde
  { prestadorId: 'evq',  diasSemana: [4],       horaIni: '08:00', horaFin: '12:00', slotMin: 15, servicioId: 'mest' },
  { prestadorId: 'evq',  diasSemana: [5],       horaIni: '10:30', horaFin: '12:00', slotMin: 15, servicioId: 'mest' },
  { prestadorId: 'evq',  diasSemana: [4, 5],    horaIni: '14:00', horaFin: '17:00', slotMin: 15, servicioId: 'mest' },

  // Henry Maya · lunes en la mañana y miércoles en la tarde
  { prestadorId: 'hamm', diasSemana: [1],       horaIni: '08:00', horaFin: '12:00', slotMin: 30, servicioId: 'mint' },
  { prestadorId: 'hamm', diasSemana: [3],       horaIni: '13:30', horaFin: '16:00', slotMin: 30, servicioId: 'mint' },

  // Carlos Moreno · el martes entra una hora más tarde que el resto de días
  { prestadorId: 'cam',  diasSemana: [1, 3, 4, 5], horaIni: '08:30', horaFin: '12:30', slotMin: 30, servicioId: 'odo' },
  { prestadorId: 'cam',  diasSemana: [2],       horaIni: '09:30', horaFin: '12:30', slotMin: 30, servicioId: 'odo' },
  { prestadorId: 'cam',  diasSemana: LUN_VIE,   horaIni: '13:00', horaFin: '15:30', slotMin: 30, servicioId: 'odo' },
  { prestadorId: 'cam',  diasSemana: SABADO,    horaIni: '08:30', horaFin: '12:00', slotMin: 30, servicioId: 'odo' },

  // Rafael Barrios · martes y viernes temprano
  { prestadorId: 'rebr', diasSemana: [2, 5],    horaIni: '07:00', horaFin: '09:40', slotMin: 15, servicioId: 'otr' },

  // Sandra Osorio · sesiones de una hora
  { prestadorId: 'sloq', diasSemana: [2],       horaIni: '08:00', horaFin: '12:00', slotMin: 60, servicioId: 'psi' },
  { prestadorId: 'sloq', diasSemana: [2, 3],    horaIni: '13:00', horaFin: '16:00', slotMin: 60, servicioId: 'psi' },
];

export interface ResumenCatalogo {
  servicios: number; prestadores: number; duraciones: number; agendas: number;
}

/**
 * Idempotente en servicios y prestadores (upsert), destructivo en agendas: las franjas
 * no tienen clave natural, así que se reemplazan en bloque como hace el cargador demo.
 *
 * **Reejecutarlo descarta los ajustes de agenda hechos a mano desde el backoffice**
 * para estos profesionales. Es el precio de que este archivo sea la fuente de verdad.
 */
export async function cargarCatalogoClinica(
  prisma: PrismaClient,
  sedeId: string,
): Promise<ResumenCatalogo> {
  for (const s of SERVICIOS) {
    await prisma.servicio.upsert({ where: { id: s.id }, update: s, create: s });
  }

  let duraciones = 0;
  for (const p of PRESTADORES) {
    const { duraciones: porServicio, ...datos } = p;
    await prisma.prestador.upsert({
      where: { id: p.id },
      update: { ...datos, sedeId },
      create: { ...datos, sedeId },
    });
    for (const [servicioId, duracionMin] of Object.entries(porServicio)) {
      await prisma.prestadorServicio.upsert({
        where: { prestadorId_servicioId: { prestadorId: p.id, servicioId } },
        update: { duracionMin },
        create: { prestadorId: p.id, servicioId, duracionMin },
      });
      duraciones++;
    }
  }

  await prisma.agenda.deleteMany({ where: { prestadorId: { in: PRESTADORES.map((p) => p.id) } } });
  for (const a of AGENDAS) {
    await prisma.agenda.create({ data: { ...a, modo: 'semanal', sedeId } });
  }

  return {
    servicios: SERVICIOS.length,
    prestadores: PRESTADORES.length,
    duraciones,
    agendas: AGENDAS.length,
  };
}
