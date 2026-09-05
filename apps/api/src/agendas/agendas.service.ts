import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { aMinutos, hoyEnSede, SEDE_ID } from '@provivir/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { cabeEnFranja, intersectaFranja } from '../citas/citas.reglas';
import { aFranjaAgenda, diaSemanaIso, franjaAplicaA, franjasSeSolapan, type Franja } from './agendas.reglas';
import type {
  ActualizarAgendaDto, BloquearAgendaDto, CrearAgendaDto, ProgramacionMensualDto, RetirarAgendaDto,
} from './dto/agenda.dto';

export { diaSemanaIso };

/**
 * Qué citas cuenta un cambio de agenda.
 *
 * El criterio se deriva de `reprogramar`, que acepta todo lo que no esté `cancelada` ni
 * `atendida`: son exactamente las citas a las que el cambio les puede quitar la
 * posibilidad de moverse. El detector de bloqueos usaba `pendiente_llegada|confirmada`,
 * que dejaba fuera a quien ya está en sala — reprogramable y sin reportar.
 */
const ESTADOS_REPROGRAMABLES = ['pendiente_llegada', 'confirmada', 'llego', 'en_atencion'] as const;

/** El modal no puede pintar 300 filas. El CONTEO nunca se trunca; la lista sí. */
const MAX_CITAS_LISTADAS = 50;

export type MotivoAfectacion = 'sale_de_franja' | 'ya_estaba_fuera';

export function aFechaUtc(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

@Injectable()
export class AgendasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  listar(prestadorId?: string, incluirRetiradas = false) {
    return this.prisma.agenda.findMany({
      where: { ...(prestadorId ? { prestadorId } : {}), ...(incluirRetiradas ? {} : { activa: true }) },
      include: { prestador: true, servicio: true },
      orderBy: [{ prestadorId: 'asc' }, { horaIni: 'asc' }],
    });
  }

  /**
   * Agendas vigentes de un prestador en una fecha: las semanales cuyo día coincide
   * más las de calendario de esa fecha exacta. Excluye las bloqueadas.
   * Es la entrada del motor de cupos (Fase 2).
   */
  async vigentesEnFecha(prestadorId: string, fecha: Date) {
    const dia = diaSemanaIso(fecha);
    const agendas = await this.prisma.agenda.findMany({
      where: { prestadorId, activa: true, bloqueada: false },
      include: { servicio: true },
    });

    return agendas.filter((a) =>
      a.modo === 'semanal'
        ? a.diasSemana.includes(dia)
        : a.fecha !== null && a.fecha.getTime() === fecha.getTime(),
    );
  }

  private validar(dto: { modo: string; diasSemana?: number[]; fecha?: string; horaIni: string; horaFin: string; slotMin: number }): void {
    if (aMinutos(dto.horaFin) <= aMinutos(dto.horaIni)) {
      throw new BadRequestException('La hora de fin debe ser posterior a la de inicio');
    }
    if (aMinutos(dto.horaFin) - aMinutos(dto.horaIni) < dto.slotMin) {
      throw new BadRequestException('La franja es más corta que un slot');
    }
    if (dto.modo === 'semanal' && !dto.diasSemana?.length) {
      throw new BadRequestException('La agenda semanal exige al menos un día');
    }
    if (dto.modo === 'calendario' && !dto.fecha) {
      throw new BadRequestException('La agenda por calendario exige una fecha');
    }
  }

  async crear(dto: CrearAgendaDto, usuarioId: string) {
    this.validar(dto);
    await this.verificarPrestador(dto.prestadorId);
    await this.exigirSinSolape(dto.prestadorId, this.aFranja(dto));

    const agenda = await this.prisma.agenda.create({
      data: {
        prestadorId: dto.prestadorId,
        modo: dto.modo,
        diasSemana: dto.diasSemana ?? [],
        fecha: dto.fecha ? aFechaUtc(dto.fecha) : null,
        horaIni: dto.horaIni,
        horaFin: dto.horaFin,
        slotMin: dto.slotMin,
        servicioId: dto.servicioId ?? null,
        consultorio: dto.consultorio ?? null,
        sedeId: SEDE_ID,
      },
      include: { prestador: true, servicio: true },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda creada',
      entidad: `agenda/${agenda.id}`,
      detalle: `${dto.prestadorId} · ${dto.modo} · ${dto.horaIni}–${dto.horaFin} · slot ${dto.slotMin} min`,
    });

    return agenda;
  }

  /**
   * RN-06.4 · programación masiva mensual. Se hace en una transacción: o quedan
   * todos los días programados o ninguno, para que administración no tenga que
   * reconstruir a mano un mes a medio cargar.
   */
  async programacionMensual(dto: ProgramacionMensualDto, usuarioId: string) {
    this.validar({ ...dto, modo: 'calendario', fecha: dto.fechas[0] });
    await this.verificarPrestador(dto.prestadorId);

    const fechas = [...new Set(dto.fechas)].map(aFechaUtc);

    const creadas = await this.prisma.$transaction(async (tx) => {
      if (dto.reemplazar) {
        await tx.agenda.deleteMany({
          where: { prestadorId: dto.prestadorId, modo: 'calendario', fecha: { in: fechas } },
        });
      }

      await tx.agenda.createMany({
        data: fechas.map((fecha) => ({
          prestadorId: dto.prestadorId,
          modo: 'calendario' as const,
          diasSemana: [],
          fecha,
          horaIni: dto.horaIni,
          horaFin: dto.horaFin,
          slotMin: dto.slotMin,
          servicioId: dto.servicioId ?? null,
          consultorio: dto.consultorio ?? null,
          sedeId: SEDE_ID,
        })),
      });

      return tx.agenda.findMany({
        where: { prestadorId: dto.prestadorId, modo: 'calendario', fecha: { in: fechas } },
        orderBy: { fecha: 'asc' },
      });
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Programación mensual',
      entidad: `prestador/${dto.prestadorId}`,
      detalle: `${fechas.length} días · ${dto.horaIni}–${dto.horaFin}`,
    });

    return { programadas: creadas.length, agendas: creadas };
  }

  /**
   * RN-06.3 · al bloquear disponibilidad con citas asignadas, la plataforma identifica
   * las citas afectadas y las devuelve para que la asistente gestione la reprogramación.
   * Con `confirmar: false` es una simulación: muestra el impacto sin tocar nada.
   */
  /**
   * RN-06.6 · Corregir una franja.
   *
   * Se fusiona el parche con la fila y se valida **el resultado**, no el parche: un
   * `{ horaFin: '07:05' }` sobre una franja que abre a las 07:00 con slot de 15 tiene que
   * fallar por «más corta que un slot», y solo la fusión lo ve.
   *
   * `prestadorId` no se acepta: mover una franja a otro médico no es editarla, y el
   * impacto calculado sería el del médico equivocado. Como el pipe global lleva
   * `forbidNonWhitelisted`, basta con que el DTO no lo declare.
   */
  async actualizar(id: string, dto: ActualizarAgendaDto, usuarioId: string) {
    const agenda = await this.exigirVigente(id);
    const propuesta = this.fusionar(agenda, dto);

    // Un cambio que no cambia nada no audita ni pide confirmación.
    if (this.sonIguales(agenda, propuesta)) {
      return { simulacion: false, citasAfectadas: 0, citas: [], recuperadas: 0, truncado: false,
        mensaje: 'No hay cambios que guardar.', agenda };
    }

    this.validar({ ...propuesta, fecha: propuesta.fecha?.toISOString().slice(0, 10) });
    await this.exigirSinSolape(agenda.prestadorId, propuesta, id);

    const impacto = await this.calcularImpacto(agenda.prestadorId, id, propuesta);
    if (impacto.citasAfectadas > 0 && !dto.confirmar) {
      return { ...impacto, simulacion: true, agenda: null };
    }

    const actualizada = await this.prisma.agenda.update({
      where: { id },
      data: {
        modo: propuesta.modo as never,
        // Normalizado en la escritura: una fila con `modo: calendario` y días sueltos, o
        // al revés, es algo que `crear` no puede producir y que la próxima consulta que
        // mire `diasSemana` sin mirar `modo` interpretará mal.
        diasSemana: propuesta.modo === 'semanal' ? propuesta.diasSemana : [],
        fecha: propuesta.modo === 'calendario' ? propuesta.fecha : null,
        horaIni: propuesta.horaIni,
        horaFin: propuesta.horaFin,
        slotMin: propuesta.slotMin,
        servicioId: propuesta.servicioId,
        consultorio: propuesta.consultorio,
      },
      include: { prestador: true, servicio: true },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda modificada',
      entidad: `agenda/${id}`,
      detalle: `${impacto.citasAfectadas} cita(s) afectada(s)`,
      estadoPrev: this.describir(agenda),
      estadoNext: this.describir(propuesta),
    });

    return { ...impacto, simulacion: false, agenda: actualizada };
  }

  /**
   * RN-06.6 · Retirar una franja.
   *
   * Baja lógica con `activa: false`, que ya filtran las dos rutas de lectura. No es un
   * borrado: es una transición de estado con inversa, igual que el bloqueo — de ahí que
   * sea un POST y no un DELETE, y de ahí que exista `reactivar`.
   */
  async retirar(id: string, dto: RetirarAgendaDto, usuarioId: string) {
    const agenda = await this.exigirVigente(id);

    const impacto = await this.calcularImpacto(agenda.prestadorId, id, null);
    if (impacto.citasAfectadas > 0 && !dto.confirmar) {
      return { ...impacto, simulacion: true, agenda: null };
    }

    const retirada = await this.prisma.agenda.update({
      where: { id }, data: { activa: false }, include: { prestador: true, servicio: true },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda retirada',
      entidad: `agenda/${id}`,
      detalle: `${this.describir(agenda)} · ${impacto.citasAfectadas} cita(s) afectada(s)`,
      estadoPrev: 'Activa',
      estadoNext: 'Retirada',
    });

    return { ...impacto, simulacion: false, agenda: retirada };
  }

  /** La inversa de retirar. Sin ella, el borrado lógico sería un borrado duro con rodeos. */
  async reactivar(id: string, usuarioId: string) {
    const agenda = await this.prisma.agenda.findUnique({ where: { id } });
    if (!agenda) throw new NotFoundException('Agenda no encontrada');
    if (agenda.activa) throw new BadRequestException('Esa franja no está retirada');

    await this.exigirSinSolape(agenda.prestadorId, agenda, id);

    const reactivada = await this.prisma.agenda.update({
      where: { id }, data: { activa: true }, include: { prestador: true, servicio: true },
    });
    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda reactivada',
      entidad: `agenda/${id}`,
      detalle: this.describir(agenda),
      estadoPrev: 'Retirada',
      estadoNext: 'Activa',
    });
    return reactivada;
  }

  async bloquear(id: string, dto: BloquearAgendaDto, usuarioId: string) {
    const agenda = await this.prisma.agenda.findUnique({ where: { id } });
    if (!agenda) throw new NotFoundException('Agenda no encontrada');

    const citasAfectadas = await this.citasAfectadasPorBloqueo(agenda);

    if (!dto.confirmar) {
      return {
        simulacion: true,
        citasAfectadas: citasAfectadas.length,
        citas: citasAfectadas,
        mensaje:
          citasAfectadas.length > 0
            ? `El bloqueo afecta ${citasAfectadas.length} cita(s). Confirme para aplicarlo y gestionar la reprogramación.`
            : 'El bloqueo no afecta citas asignadas.',
      };
    }

    await this.prisma.agenda.update({
      where: { id },
      data: { bloqueada: true, motivoBloqueo: dto.motivo },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda bloqueada',
      entidad: `agenda/${id}`,
      detalle: `${dto.motivo} · ${citasAfectadas.length} cita(s) afectada(s)`,
      estadoPrev: 'Activa',
      estadoNext: 'Bloqueada',
    });

    return {
      simulacion: false,
      citasAfectadas: citasAfectadas.length,
      citas: citasAfectadas,
      // La notificación por WhatsApp se encola en la Fase 4; aquí queda el conflicto
      // en manos de la asistente, como define RN-06.3.
      mensaje: `Agenda bloqueada. ${citasAfectadas.length} cita(s) requieren reprogramación.`,
    };
  }

  async desbloquear(id: string, usuarioId: string) {
    const agenda = await this.prisma.agenda.findUnique({ where: { id } });
    if (!agenda) throw new NotFoundException('Agenda no encontrada');

    const actualizada = await this.prisma.agenda.update({
      where: { id },
      data: { bloqueada: false, motivoBloqueo: null },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Agenda desbloqueada',
      entidad: `agenda/${id}`,
      estadoPrev: 'Bloqueada',
      estadoNext: 'Activa',
    });

    return actualizada;
  }

  /** Citas futuras del prestador que caen dentro de la franja de la agenda. */
  private async citasAfectadasPorBloqueo(agenda: { prestadorId: string; modo: string; fecha: Date | null; diasSemana: number[]; horaIni: string; horaFin: string }) {
    const hoy = hoyEnSede();

    const citas = await this.prisma.cita.findMany({
      where: {
        prestadorId: agenda.prestadorId,
        estado: { in: ['pendiente_llegada', 'confirmada'] },
        fecha: agenda.modo === 'calendario' && agenda.fecha ? agenda.fecha : { gte: hoy },
      },
      include: { paciente: { select: { id: true, nombres: true, apellidos: true, telefono: true } }, servicio: true },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    const ini = aMinutos(agenda.horaIni);
    const fin = aMinutos(agenda.horaFin);

    return citas.filter((c) => {
      const dentroDeFranja = c.horaInicio >= ini && c.horaInicio < fin;
      if (!dentroDeFranja) return false;
      if (agenda.modo === 'calendario') return true;
      return agenda.diasSemana.includes(diaSemanaIso(c.fecha));
    });
  }

  // ─────────────── RN-06.6 · el impacto de un cambio de agenda ───────────────

  /**
   * Qué citas se quedan fuera si esta franja pasa a ser `propuesta` (o desaparece, si es
   * `null`).
   *
   * La formulación importa. No es «cabía en la vieja y no cabe en la nueva», sino:
   *
   *   **afectada ⟺ después del cambio, NINGUNA franja vigente del prestador la contiene.**
   *
   * Tres cosas salen gratis de plantearlo así, y ninguna salía de la otra forma:
   * - Es, por construcción, «`validarCupo` la rechazaría ahora». La previsualización no
   *   puede divergir de la validación porque es la misma pregunta.
   * - El rescate por **otra** franja del mismo prestador se contempla solo (un médico con
   *   mañana y tarde).
   * - Sirve igual para editar y para retirar: retirar es «la franja no está en el después».
   *
   * Las candidatas se recogen con el predicado LAXO sobre la unión de días viejos y
   * nuevos: una cita desalineada o que desborda el cierre no *cabe* en la franja, pero
   * *vive* en ella, y quitarla la deja huérfana. Con el estricto no se recogería.
   */
  private async calcularImpacto(prestadorId: string, agendaId: string, propuesta: Franja | null) {
    const vivas = await this.prisma.agenda.findMany({
      where: { prestadorId, activa: true, bloqueada: false },
    });
    const antes: Franja[] = vivas;
    const despues: Franja[] = [
      ...vivas.filter((a) => a.id !== agendaId),
      ...(propuesta ? [propuesta] : []),
    ];
    const vieja = vivas.find((a) => a.id === agendaId);

    const citas = await this.prisma.cita.findMany({
      where: {
        prestadorId,
        estado: { in: ESTADOS_REPROGRAMABLES as unknown as Prisma.EnumEstadoCitaFilter['in'] },
        fecha: { gte: hoyEnSede() },
      },
      include: { paciente: { select: { id: true, nombres: true, apellidos: true, telefono: true } }, servicio: true },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    const afectadas: Array<(typeof citas)[number] & { motivo: MotivoAfectacion }> = [];
    let recuperadas = 0;

    for (const c of citas) {
      // Solo los días que el cambio toca: la unión de los viejos y los nuevos. Sin la
      // unión, añadir y quitar días en el mismo guardado dejaría fuera lo recuperado.
      const leAplica = (vieja && franjaAplicaA(c.fecha, vieja))
        || (propuesta !== null && franjaAplicaA(c.fecha, propuesta));
      if (!leAplica) continue;

      // Y solo las que PISAN alguna de las dos franjas: el resto del día no lo toca nadie.
      const pisa = (vieja && franjaAplicaA(c.fecha, vieja) && intersectaFranja(c, aFranjaAgenda(vieja)))
        || (propuesta && franjaAplicaA(c.fecha, propuesta) && intersectaFranja(c, aFranjaAgenda(propuesta)));
      if (!pisa) continue;

      const cabiaAntes = this.cabeEnAlguna(c, antes);
      const cabeDespues = this.cabeEnAlguna(c, despues);

      if (!cabeDespues) {
        /*
         * Se distingue la que YA estaba fuera. Con el conteo mezclado, el operador lee
         * «4 citas afectadas» y cree que su edición rompió las cuatro; con el motivo
         * aparte ve «3 salen de la franja · 1 ya estaba fuera». Esconderlas sería peor:
         * significaría aplicar el cambio y dejar a un paciente sin cupo reprogramable en
         * silencio.
         */
        afectadas.push({ ...c, motivo: cabiaAntes ? 'sale_de_franja' : 'ya_estaba_fuera' });
      } else if (!cabiaAntes) {
        recuperadas += 1;
      }
    }

    const yaEstaban = afectadas.filter((c) => c.motivo === 'ya_estaba_fuera').length;
    return {
      citasAfectadas: afectadas.length,
      // El CONTEO nunca se trunca; la lista sí. Sub-reportar el radio de impacto en un
      // diálogo de confirmación es el único error imperdonable aquí.
      citas: afectadas.slice(0, MAX_CITAS_LISTADAS),
      truncado: afectadas.length > MAX_CITAS_LISTADAS,
      recuperadas,
      mensaje: this.mensajeDeImpacto(afectadas.length, yaEstaban, recuperadas),
    };
  }

  private cabeEnAlguna(cita: { fecha: Date; horaInicio: number; duracionMin: number }, franjas: Franja[]): boolean {
    return franjas.some((f) => franjaAplicaA(cita.fecha, f) && cabeEnFranja(cita, aFranjaAgenda(f)));
  }

  private mensajeDeImpacto(afectadas: number, yaEstaban: number, recuperadas: number): string {
    if (afectadas === 0) {
      return recuperadas > 0
        ? `El cambio no deja ninguna cita fuera y recupera ${recuperadas} que estaba(n) fuera de la agenda.`
        : 'El cambio no deja ninguna cita fuera de la agenda.';
    }
    const nuevas = afectadas - yaEstaban;
    const cola = yaEstaban > 0 ? ` (${yaEstaban} ya estaba(n) fuera antes de este cambio)` : '';
    return `${nuevas} cita(s) quedarían fuera de la agenda${cola}. `
      + 'Se seguirán atendiendo, pero no se podrán reprogramar hasta que la franja vuelva a cubrirlas. '
      + 'Incluye las citas de hoy que aún figuran sin registro de llegada.';
  }

  // ─────────────── RN-06.7 · dos franjas del mismo prestador no se pisan ───────────────

  /**
   * Cuando dos franjas se pisan, el portal ofrece **la misma hora dos veces**: `cupos()`
   * las recorre por separado y no deduplica dentro de un prestador. Nunca se validó.
   *
   * Solo **dentro del mismo modo**. Rechazar también el cruce semanal × calendario
   * cerraría la única forma que hoy existe de decir «ese jueves concreto atiende de 8 a
   * 10»: `bloquear` apagaría todos los jueves y `DiaNoLaborable` cierra la sede entera.
   * Mientras no haya precedencia de calendario sobre semanal, dejar sin remedio al
   * operador es peor que el riesgo de una hora duplicada — y hoy el catálogo es todo
   * semanal, así que ese riesgo es cero.
   *
   * Contra las bloqueadas tampoco: no generan cupos, y rechazarlo rompería el flujo real
   * de «bloqueo la vieja, creo la nueva».
   */
  private async exigirSinSolape(prestadorId: string, franja: Franja, excluirId?: string): Promise<void> {
    const otras = await this.prisma.agenda.findMany({
      where: {
        prestadorId, activa: true, bloqueada: false,
        ...(excluirId ? { id: { not: excluirId } } : {}),
      },
    });

    const choca = otras.filter((o) => o.modo === franja.modo).find((o) => franjasSeSolapan(franja, o));
    if (choca) {
      throw new BadRequestException(
        `Esa franja se solapa con ${choca.horaIni}–${choca.horaFin} del mismo prestador. `
        + 'Dos franjas que se pisan hacen que el portal ofrezca la misma hora dos veces.',
      );
    }
  }

  // ─────────────── auxiliares ───────────────

  /** Una franja retirada no se edita ni se bloquea: primero hay que reactivarla. */
  private async exigirVigente(id: string) {
    const agenda = await this.prisma.agenda.findUnique({ where: { id } });
    if (!agenda || !agenda.activa) throw new NotFoundException('Agenda no encontrada');
    return agenda;
  }

  private aFranja(dto: { modo: string; diasSemana?: number[]; fecha?: string; horaIni: string; horaFin: string; slotMin: number }): Franja {
    return {
      modo: dto.modo,
      diasSemana: dto.diasSemana ?? [],
      fecha: dto.fecha ? aFechaUtc(dto.fecha) : null,
      horaIni: dto.horaIni,
      horaFin: dto.horaFin,
      slotMin: dto.slotMin,
    };
  }

  /** El parche sobre la fila, con los campos que el parche no trae tal como estaban. */
  private fusionar(agenda: Franja & { servicioId: string | null; consultorio: string | null }, dto: ActualizarAgendaDto) {
    return {
      modo: dto.modo ?? agenda.modo,
      diasSemana: dto.diasSemana ?? agenda.diasSemana,
      fecha: dto.fecha ? aFechaUtc(dto.fecha) : agenda.fecha,
      horaIni: dto.horaIni ?? agenda.horaIni,
      horaFin: dto.horaFin ?? agenda.horaFin,
      slotMin: dto.slotMin ?? agenda.slotMin,
      servicioId: dto.servicioId === undefined ? agenda.servicioId : (dto.servicioId || null),
      consultorio: dto.consultorio === undefined ? agenda.consultorio : (dto.consultorio || null),
    };
  }

  private sonIguales(a: Franja & { servicioId: string | null; consultorio: string | null },
                     b: Franja & { servicioId: string | null; consultorio: string | null }): boolean {
    return a.modo === b.modo
      && a.horaIni === b.horaIni && a.horaFin === b.horaFin && a.slotMin === b.slotMin
      && a.servicioId === b.servicioId && a.consultorio === b.consultorio
      && a.fecha?.getTime() === b.fecha?.getTime()
      && a.diasSemana.length === b.diasSemana.length
      && a.diasSemana.every((d) => b.diasSemana.includes(d));
  }

  /** El texto que va a la auditoría: tiene que bastar para reconstruir la franja a mano. */
  private describir(f: Franja): string {
    const cuando = f.modo === 'semanal'
      ? `días ${[...f.diasSemana].sort((x, y) => x - y).join(',')}`
      : (f.fecha?.toISOString().slice(0, 10) ?? 'sin fecha');
    return `${f.horaIni}–${f.horaFin} · ${cuando} · slot ${f.slotMin} min`;
  }

  private async verificarPrestador(prestadorId: string): Promise<void> {
    const prestador = await this.prisma.prestador.findUnique({ where: { id: prestadorId } });
    if (!prestador) throw new NotFoundException('Prestador no encontrado');
  }
}
