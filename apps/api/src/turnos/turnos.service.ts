import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TurnosGateway } from './turnos.gateway';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { esModoNombre, nombreParaPantalla, type ModoNombre } from '../pantallas/nombre-en-pantalla';
import { minutosEsperando, ordenarCola, prioridadPorCondiciones } from './turnos.reglas';
import { exigeNota, motivoPorPolitica } from './cobro.reglas';
import type { LlamarSiguienteDto, PriorizarTurnoDto, RegistrarLlegadaDto } from './dto/turno.dto';
import { hoyEnSede, SEDE_ID, type PoliticaCosto, type Prioridad } from '@provivir/shared';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const INCLUIR = {
  cita: { include: { paciente: true, prestador: true, servicio: true } },
} as const;

/** Mismos márgenes que el motor de citas: con locks, las peticiones hacen cola. */
const OPCIONES_TX = { maxWait: 15_000, timeout: 20_000 } as const;

@Injectable()
export class TurnosService {
  /** Cómo se muestra el paciente en los televisores. Ver nombre-en-pantalla.ts */
  private modoNombre(): ModoNombre {
    const crudo = this.configuracion.texto('mostrar_nombre_en_pantalla', 'abreviado');
    return esModoNombre(crudo) ? crudo : 'abreviado';
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: TurnosGateway,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /**
   * RN-07.1 · Flujo real del cliente: el paciente llega, paga en recepción y el
   * mostrador registra la llegada. No hay turno intermedio de pago, y el kiosko
   * está desactivado en esta etapa (D3).
   */
  async registrarLlegada(dto: RegistrarLlegadaDto, usuarioId: string) {
    if (!dto.codigo && !dto.documento) {
      throw new BadRequestException('Indique el código de atención o el documento');
    }

    // El día se calcula en la hora de la sede (Cali), no en la del servidor.
    const hoy = hoyEnSede();

    const cita = await this.prisma.cita.findFirst({
      where: {
        fecha: hoy,
        estado: { in: ['pendiente_llegada', 'confirmada'] },
        ...(dto.codigo ? { codigo: dto.codigo.toUpperCase() } : {}),
        ...(dto.documento ? { paciente: { documento: dto.documento } } : {}),
      },
      include: { paciente: true, prestador: true, servicio: true },
      orderBy: { horaInicio: 'asc' },
    });

    if (!cita) throw new NotFoundException('No se encontró una cita de hoy pendiente de llegada');

    const existente = await this.prisma.turno.findUnique({ where: { citaId: cita.id } });
    if (existente) throw new BadRequestException('La llegada de esta cita ya fue registrada');

    /*
     * RN-07.6 · La nota se exige ANTES de tocar nada: si falta, no puede quedar ni el
     * turno creado ni la cita en `llego`. Y se comprueba aquí y no en el DTO porque
     * depende de la política del servicio, que el cliente no debería poder declarar.
     */
    const cobro = this.resolverCobro(cita.servicio.politicaCosto, dto);

    // RN-05.2 · las marcas preferenciales del paciente definen la prioridad de entrada.
    const prioridad = prioridadPorCondiciones(cita.paciente.condiciones);

    const turno = await this.prisma.$transaction(async (tx) => {
      const t = await tx.turno.create({
        data: {
          citaId: cita.id,
          prioridad,
          consultorio: dto.consultorio ?? cita.prestador.consultorio,
          ...this.datosDeCobro(dto, usuarioId),
        },
        include: INCLUIR,
      });
      await tx.cita.update({ where: { id: cita.id }, data: { estado: 'llego' } });
      return t;
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Registro de llegada',
      entidad: `cita/${cita.codigo}`,
      // Dice lo que pasó, no lo que la regla supone. Antes era la cadena fija
      // «Mostrador · pago en recepción», escrita hubiera cobro o no.
      detalle: `Mostrador · ${cobro.resumen} · prioridad ${prioridad}`,
      estadoPrev: cita.estado,
      estadoNext: 'llego',
    });

    /*
     * Entrada aparte cuando el desenlace contradice la política. Así «quién eximió a
     * quién y por qué» se consulta por acción en la vista de auditoría, en vez de
     * buscar dentro del texto de los registros de llegada.
     */
    if (cobro.contradicePolitica) {
      await this.auditoria.registrar({
        usuario: usuarioId,
        accion: 'Excepción de cobro',
        entidad: `cita/${cita.codigo}`,
        detalle: dto.cobroNota,
        estadoPrev: cita.servicio.politicaCosto,
        estadoNext: dto.cobro,
      });
    }

    this.gateway.emitirColaActualizada();
    return turno;
  }

  /**
   * RN-07.6 · Valida el desenlace del cobro contra la política del servicio y arma lo
   * que va a la traza.
   *
   * No bloquea nada más: si la política del catálogo está mal, la asistente registra
   * igual dejando nota. Corregir el catálogo es asunto de administración, no del
   * paciente que está esperando delante.
   */
  private resolverCobro(politica: PoliticaCosto, dto: RegistrarLlegadaDto) {
    const contradicePolitica = exigeNota(politica, dto.cobro);

    if (contradicePolitica && !dto.cobroNota?.trim()) {
      throw new BadRequestException(
        dto.cobro === 'exento'
          ? 'Este servicio se cobra: explica por qué no se cobró (RN-07.6)'
          : 'Este servicio no tiene costo: explica por qué se cobró (RN-07.6)',
      );
    }

    const porPolitica = motivoPorPolitica(politica, dto.cobro);
    const resumen = dto.cobro === 'cobrado' ? 'cobrado' : 'no se cobró';
    return {
      contradicePolitica,
      resumen: dto.cobroNota
        ? `${resumen} · «${dto.cobroNota.trim()}»`
        : porPolitica ? `${resumen} (${porPolitica})` : resumen,
    };
  }

  /**
   * Los cuatro campos de la constancia, juntos y en un solo sitio.
   *
   * Extraído a propósito: cuando el kiosko se encienda, la llegada y el cobro dejarán
   * de ser el mismo acto y la caja completará estos mismos campos por su cuenta. Que
   * ya estén reunidos es lo que evita rehacerlo.
   */
  private datosDeCobro(dto: RegistrarLlegadaDto, usuarioId: string) {
    return {
      cobro: dto.cobro,
      cobroNota: dto.cobroNota?.trim() || null,
      cobradoPor: usuarioId,
      cobroTs: new Date(),
    };
  }

  /**
   * Cola del día ordenada por RN-05.2: prioridad primero, luego orden de llegada.
   *
   * **Del día**, literalmente: sin el filtro de fecha, un turno que se quede abierto
   * de un día para otro sigue apareciendo indefinidamente. Con la cola de un solo
   * médico apenas se nota; en la vista de toda la sala es lo primero que se ve, con
   * «esperando 1.440 min». Se usa la fecha de la SEDE, la misma con la que
   * `registrarLlegada` encontró la cita.
   *
   * Ojo con lo que esto no arregla: el turno olvidado desaparece de la vista pero
   * sigue vivo, y su cita sigue en `llego`. Cerrarlo de verdad es el cierre del día,
   * que todavía no existe — nadie escribe nunca `ausente`.
   *
   * `cliente` permite leerla DENTRO de una transacción, que es lo que necesita
   * `llamarSiguiente` para que su lock sirva de algo.
   */
  async cola(prestadorId?: string, cliente: Tx = this.prisma) {
    const turnos = await cliente.turno.findMany({
      where: {
        estado: { in: ['en_espera', 'llamado'] },
        cita: { fecha: hoyEnSede(), ...(prestadorId ? { prestadorId } : {}) },
      },
      include: INCLUIR,
    });

    const ordenados = ordenarCola(
      turnos.map((t) => ({ ...t, condiciones: t.cita.paciente.condiciones })),
    );

    return ordenados.map((t) => ({
      ...t,
      minutosEsperando: minutosEsperando(t.llegadaTs),
    }));
  }

  /**
   * RN-07.3 · el llamado es automático al siguiente en cola. El prestador no elige
   * a quién llamar; si quiere adelantar a alguien usa la priorización con nota (RN-07.4).
   */
  async llamarSiguiente(dto: LlamarSiguienteDto, usuarioId: string) {
    /*
     * La cola se lee DENTRO de la transacción y detrás de un lock, porque desde que
     * la asistente también puede llamar hay dos personas sobre la misma cola. Leer
     * fuera y actualizar por id dejaba que ambas resolvieran el mismo paciente: la
     * segunda pisaba el `llamadoTs` de la primera y las pantallas lo llamaban dos
     * veces.
     *
     * Con lock y no con una actualización condicional a propósito: así la segunda
     * persona obtiene EL SIGUIENTE paciente, que es lo que quería, en vez de un
     * conflicto que no sabría interpretar.
     */
    const turno = await this.prisma.$transaction(async (tx) => {
      await this.lockCola(tx, dto.prestadorId);

      const cola = await this.cola(dto.prestadorId, tx);
      const siguiente = cola.find((t) => t.estado === 'en_espera');
      if (!siguiente) throw new NotFoundException('No hay pacientes en espera');

      const t = await tx.turno.update({
        where: { id: siguiente.id },
        data: {
          estado: 'llamado',
          llamadoTs: new Date(),
          consultorio: dto.consultorio ?? siguiente.consultorio,
        },
        include: INCLUIR,
      });
      await tx.cita.update({ where: { id: t.citaId }, data: { estado: 'en_atencion' } });
      return t;
    }, OPCIONES_TX);

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Llamado de turno',
      entidad: `cita/${turno.cita.codigo}`,
      detalle: `${turno.cita.prestador.nombre} · ${turno.consultorio ?? 'sin consultorio'}`,
      estadoPrev: 'en_espera',
      estadoNext: 'llamado',
    });

    // RN-11.1 · solo las pantallas configuradas para ese servicio muestran el llamado.
    const pantallas = await this.prisma.pantalla.findMany({
      where: { servicios: { has: turno.cita.servicioId } },
      select: { id: true },
    });

    this.gateway.emitirLlamado(
      pantallas.map((p) => p.id),
      {
        turnoId: turno.id,
        codigo: turno.cita.codigo,
        // Mismo criterio que el estado que consulta la pantalla: si divergieran,
        // el nombre completo se colaría por el canal en vivo.
        paciente: nombreParaPantalla(
          turno.cita.paciente.nombres,
          turno.cita.paciente.apellidos,
          this.modoNombre(),
        ),
        prestador: turno.cita.prestador.nombre,
        consultorio: turno.consultorio,
        servicioId: turno.cita.servicioId,
        ts: new Date().toISOString(),
      },
    );
    this.gateway.emitirColaActualizada();

    return turno;
  }

  /**
   * Advisory lock transaccional sobre la cola de UN prestador en el día de hoy.
   *
   * Lleva el prestador dentro de la clave para que dos médicos distintos no se
   * bloqueen entre sí, y el sufijo `:turnos` para no chocar con el lock del motor de
   * citas (`lockPrestadorFecha`), que usa la misma forma de clave sin sufijo: son
   * dos colas distintas y compartirlas serializaría el agendamiento con el llamado
   * sin ninguna razón.
   */
  private async lockCola(tx: Tx, prestadorId: string): Promise<void> {
    const dia = hoyEnSede().toISOString().slice(0, 10);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${SEDE_ID}:${dia}:${prestadorId}:turnos`}))`;
  }

  /**
   * RN-07.4 · Priorización por el prestador. La nota del motivo es OBLIGATORIA
   * (la valida el DTO) y todo queda auditado.
   */
  async priorizar(id: string, dto: PriorizarTurnoDto, usuarioId: string) {
    const turno = await this.prisma.turno.findUnique({ where: { id }, include: INCLUIR });
    if (!turno) throw new NotFoundException('Turno no encontrado');

    const actualizado = await this.prisma.turno.update({
      where: { id },
      data: {
        prioridad: dto.prioridad as Prioridad,
        notaPriorizacion: dto.nota,
        priorizadoPor: usuarioId,
      },
      include: INCLUIR,
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Priorización de turno',
      entidad: `cita/${turno.cita.codigo}`,
      detalle: dto.nota,
      estadoPrev: turno.prioridad,
      estadoNext: dto.prioridad,
    });

    this.gateway.emitirColaActualizada();
    return actualizado;
  }

  async finalizar(id: string, usuarioId: string) {
    const turno = await this.prisma.turno.findUnique({ where: { id }, include: INCLUIR });
    if (!turno) throw new NotFoundException('Turno no encontrado');

    const actualizado = await this.prisma.$transaction(async (tx) => {
      const t = await tx.turno.update({ where: { id }, data: { estado: 'atendido' }, include: INCLUIR });
      await tx.cita.update({ where: { id: t.citaId }, data: { estado: 'atendida' } });
      return t;
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Atención finalizada',
      entidad: `cita/${turno.cita.codigo}`,
      estadoPrev: turno.estado,
      estadoNext: 'atendido',
    });

    this.gateway.emitirColaActualizada();
    return actualizado;
  }

  /** Últimos llamados, para que la pantalla los muestre al conectarse. */
  async ultimosLlamados(servicios: string[], limite: number) {
    return this.prisma.turno.findMany({
      where: { estado: { in: ['llamado', 'en_atencion'] }, cita: { servicioId: { in: servicios } } },
      include: INCLUIR,
      orderBy: { llamadoTs: 'desc' },
      take: limite,
    });
  }
}
