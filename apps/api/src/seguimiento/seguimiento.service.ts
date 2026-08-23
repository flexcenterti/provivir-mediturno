import { Injectable, Logger } from '@nestjs/common';
import type { PasoSeguimiento } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { MetaCliente } from '../whatsapp/meta.cliente';
import { enmascararTelefono } from '../comun/pii';
import { hoyEnSede } from '@provivir/shared';
import {
  dentroDeVentanaMeta,
  dentroDelHorario,
  HORARIO_POR_DEFECTO,
  momentoDeEnvio,
  proximoHabil,
  RETRASOS_MIN,
} from './seguimiento.horario';
import { textoDelPaso, type FichaParaMensaje } from './seguimiento.mensajes';

export const CLAVE_ACTIVO = 'seguimiento_comercial_activo';
export const CLAVE_DIAS_ENTRE = 'seguimiento_comercial_dias_entre';

const PASOS: PasoSeguimiento[] = ['seguimiento_1', 'seguimiento_2', 'cierre'];
const DIAS_ENTRE_SECUENCIAS = 30;

/** Por qué no salió un envío. Se registra siempre: sin esto no hay forma de auditar. */
type Corte =
  | 'paciente_respondio'
  | 'ya_agendo'
  | 'no_contactar'
  | 'en_gestion_humana'
  | 'servicio_inactivo'
  | 'fuera_de_ventana_meta'
  | 'secuencia_cancelada';

/**
 * Seguimiento comercial del interesado que no agenda (RN-09.9).
 *
 * Extiende la mecánica de RN-09.8, que ya difería un mensaje y verificaba que no
 * hubiera cita antes de escribir. Lo que agrega: tres pasos, contenido desde la
 * ficha comercial, ventana horaria, límites de insistencia y opt-out.
 */
@Injectable()
export class SeguimientoService {
  private readonly log = new Logger(SeguimientoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionService,
    private readonly meta: MetaCliente,
  ) {}

  activo(): boolean {
    return this.configuracion.booleano(CLAVE_ACTIVO, true);
  }

  // ─────────────────────────── Armado ───────────────────────────

  /**
   * RN-09.9.1 · Arma la secuencia si la conversación quedó con interés, con
   * ofrecimiento hecho y sin cita. Devuelve los pasos programados.
   *
   * `t0` es el último mensaje de la conversación, no el de la pregunta: así nunca
   * se le escribe encima a alguien que todavía está conversando.
   */
  async armar(entrada: {
    conversacionId: string;
    telefono: string;
    servicioId: string;
    pacienteId?: string | null;
    sedeId: string;
    t0?: Date;
  }): Promise<number> {
    if (!this.activo()) return 0;

    const t0 = entrada.t0 ?? new Date();

    if (await this.tieneSecuenciaReciente(entrada.telefono, entrada.servicioId)) {
      this.log.debug(`Seguimiento omitido: ${enmascararTelefono(entrada.telefono)} ya tuvo una secuencia reciente`);
      return 0;
    }
    if (await this.tieneSecuenciaActiva(entrada.telefono)) return 0;
    if (entrada.pacienteId && (await this.optOut(entrada.pacienteId))) return 0;
    // RN-09.9.1.3 · puede tener la cita de antes de esta conversación.
    if (await this.yaTieneCita(entrada.telefono, entrada.servicioId, entrada.pacienteId)) return 0;

    const horario = this.horario();
    let programados = 0;

    for (const paso of PASOS) {
      const programadoPara = momentoDeEnvio(t0, paso as keyof typeof RETRASOS_MIN, horario);

      // RN-09.9.6 · lo que no quepa en la ventana de 24 h no se programa: solo
      // podría salir como plantilla aprobada, y no hay ninguna.
      if (!dentroDeVentanaMeta(t0, programadoPara)) {
        this.log.debug(`Paso ${paso} descartado: cae fuera de la ventana de 24 h de Meta`);
        continue;
      }

      try {
        await this.prisma.seguimiento.create({
          data: {
            conversacionId: entrada.conversacionId,
            pacienteId: entrada.pacienteId ?? null,
            telefono: entrada.telefono,
            servicioId: entrada.servicioId,
            paso,
            programadoPara,
            sedeId: entrada.sedeId,
          },
        });
        programados++;
      } catch {
        // Choque con el índice único: la secuencia ya estaba armada. Rearmar no
        // puede duplicar envíos (RN-09.9.7), así que se ignora en silencio.
        return programados;
      }
    }

    if (programados) {
      await this.auditoria.registrar({
        usuario: 'ia',
        accion: 'Seguimiento comercial armado',
        entidad: `conversacion/${entrada.conversacionId}`,
        detalle: `${programados} envío(s) · servicio ${entrada.servicioId}`,
        estadoNext: 'programado',
      });
    }
    return programados;
  }

  // ─────────────────────────── Envío ───────────────────────────

  /**
   * Lo que toca enviar ahora. El worker lo llama periódicamente en vez de programar
   * un trabajo diferido por paso: la tabla ya es la fuente de verdad y así un
   * reinicio del proceso no pierde envíos programados.
   */
  async pendientesDeEnvio(ahora = new Date()) {
    return this.prisma.seguimiento.findMany({
      where: { estado: 'programado', programadoPara: { lte: ahora } },
      orderBy: { programadoPara: 'asc' },
      take: 50,
    });
  }

  /**
   * RN-09.9.4 · Revalida TODO justo antes de enviar, no al programar.
   *
   * El orden importa: las condiciones que cancelan se evalúan antes que las que
   * difieren. No tiene sentido reprogramar un envío que de todos modos no debía
   * salir. El paciente pudo agendar por teléfono una hora después de armarse la
   * secuencia, y escribirle a quien ya tiene su cita destruye la confianza en el canal.
   */
  async despachar(seguimientoId: string, ahora = new Date()): Promise<'enviado' | Corte | 'diferido'> {
    const s = await this.prisma.seguimiento.findUnique({
      where: { id: seguimientoId },
      include: { conversacion: true, servicio: true, paciente: true },
    });
    if (!s || s.estado !== 'programado') return 'secuencia_cancelada';

    // 1 · ¿respondió el paciente después de armarse la secuencia?
    const ultimoEntrante = await this.prisma.mensaje.findFirst({
      where: { conversacionId: s.conversacionId, direccion: 'entrante' },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });
    if (ultimoEntrante && ultimoEntrante.ts > s.creadoEn) {
      return this.cancelarSecuencia(s.conversacionId, 'paciente_respondio');
    }

    // 2 · ¿ya tiene su cita, por CUALQUIER canal?
    // La pregunta es si la persona YA TIENE cita, no si la sacó después de armarse
    // la secuencia: a quien ya la tenía tampoco hay que escribirle.
    if (await this.yaTieneCita(s.telefono, s.servicioId, s.pacienteId)) {
      return this.cancelarSecuencia(s.conversacionId, 'ya_agendo');
    }

    // 3 · opt-out permanente (Ley 1581/2012)
    if (s.paciente?.noContactar) return this.cancelarSecuencia(s.conversacionId, 'no_contactar');

    // 4 · una asistente ya está atendiendo: la plataforma no le escribe encima
    if (s.conversacion.resueltaTs || s.conversacion.tomadaPor || s.conversacion.escalada) {
      return this.cancelarSecuencia(s.conversacionId, 'en_gestion_humana');
    }

    // 5 · el servicio se desactivó (RN-04.5.4)
    if (!s.servicio.activo) return this.cancelarSecuencia(s.conversacionId, 'servicio_inactivo');

    // 6 · ventana horaria: aquí sí se difiere, no se cancela.
    // Diferir es solo mover `programadoPara`: la fila sigue en `programado` porque
    // el índice único parcial que limita la insistencia (RN-09.9.7.3) cuenta ese
    // estado. Sacarla de ahí abriría hueco para una segunda secuencia.
    const horario = this.horario();
    if (!dentroDelHorario(ahora, horario)) {
      const nuevo = proximoHabil(ahora, horario);
      await this.prisma.seguimiento.update({
        where: { id: s.id },
        data: { programadoPara: nuevo },
      });
      this.log.debug(`Seguimiento ${s.paso} diferido a ${nuevo.toISOString()} por horario`);
      return 'diferido';
    }

    // 7 · ventana de 24 h de Meta. Se cuenta desde el ÚLTIMO MENSAJE DEL PACIENTE,
    // que es donde Meta abre la ventana de atención al cliente — no desde que se
    // armó la secuencia. En producción se parecen, pero no son lo mismo, y de la
    // diferencia depende que el mensaje pueda salir como texto libre o no.
    const aperturaVentana = ultimoEntrante?.ts ?? s.creadoEn;
    if (!dentroDeVentanaMeta(aperturaVentana, ahora)) {
      await this.prisma.seguimiento.update({
        where: { id: s.id },
        data: {
          estado: 'descartado',
          motivoCancelacion: 'Fuera de la ventana de 24 h de Meta y sin plantilla aprobada',
        },
      });
      return 'fuera_de_ventana_meta';
    }

    const texto = textoDelPaso(s.paso, this.ficha(s.servicio));
    const waMessageId = await this.meta.enviarTexto(s.telefono, texto);

    await this.prisma.$transaction(async (tx) => {
      await tx.mensaje.create({
        data: {
          conversacionId: s.conversacionId,
          direccion: 'saliente',
          tipo: 'texto',
          contenido: texto,
          waMessageId: waMessageId || null,
        },
      });
      await tx.seguimiento.update({
        where: { id: s.id },
        data: { estado: 'enviado', enviadoEn: new Date() },
      });
    });

    this.log.log(`Seguimiento ${s.paso} enviado a ${enmascararTelefono(s.telefono)}`);
    return 'enviado';
  }

  /** Cancela lo que quede pendiente de la secuencia de esa conversación. */
  async cancelarSecuencia(conversacionId: string, motivo: Corte | string): Promise<Corte> {
    await this.prisma.seguimiento.updateMany({
      where: { conversacionId, estado: 'programado' },
      data: { estado: 'cancelado', motivoCancelacion: String(motivo) },
    });
    return motivo as Corte;
  }

  /** RN-04.5.4 · al desactivar un servicio se cancela lo suyo. */
  async cancelarPorServicio(servicioId: string): Promise<number> {
    const { count } = await this.prisma.seguimiento.updateMany({
      where: { servicioId, estado: 'programado' },
      data: {
        estado: 'cancelado',
        motivoCancelacion: 'Servicio desactivado: no se persigue a nadie por algo que ya no se presta',
      },
    });
    return count;
  }

  /** Lo que ve la asistente en su bandeja (RN-09.9.8). */
  async interesados() {
    const filas = await this.prisma.seguimiento.findMany({
      where: { OR: [{ estado: 'programado' }, { estado: 'enviado' }] },
      orderBy: { creadoEn: 'desc' },
      include: { servicio: { select: { nombre: true } }, paciente: { select: { nombres: true, apellidos: true } } },
      take: 200,
    });

    // Una fila por conversación: la secuencia son tres registros, no tres casos.
    const porConversacion = new Map<string, typeof filas>();
    for (const f of filas) {
      porConversacion.set(f.conversacionId, [...(porConversacion.get(f.conversacionId) ?? []), f]);
    }

    return [...porConversacion.values()].map((pasos) => {
      const primero = pasos[0]!;
      const enviados = pasos.filter((p) => p.estado === 'enviado').length;
      const proximo = pasos
        .filter((p) => p.estado === 'programado')
        .sort((a, b) => a.programadoPara.getTime() - b.programadoPara.getTime())[0];

      return {
        conversacionId: primero.conversacionId,
        telefono: primero.telefono,
        paciente: primero.paciente ? `${primero.paciente.nombres} ${primero.paciente.apellidos}` : null,
        servicio: primero.servicio.nombre,
        desde: primero.creadoEn,
        enviados,
        totalPasos: pasos.length,
        proximoPaso: proximo?.paso ?? null,
        proximoEnvio: proximo?.programadoPara ?? null,
      };
    });
  }

  // ─────────────────────────── Interno ───────────────────────────

  private horario() {
    return {
      ...HORARIO_POR_DEFECTO,
      aperturaMin: this.configuracion.numero('seguimiento_hora_apertura', 7) * 60,
      cierreMin: this.configuracion.numero('seguimiento_hora_cierre', 18) * 60,
    };
  }

  private ficha(servicio: {
    nombre: string;
    duracionMin: number;
    requiereOrden: boolean;
    beneficios: string[];
    preparacion: string | null;
  }): FichaParaMensaje {
    return {
      nombre: servicio.nombre,
      duracionMin: servicio.duracionMin,
      requiereOrden: servicio.requiereOrden,
      beneficios: servicio.beneficios,
      preparacion: servicio.preparacion,
    };
  }

  /** RN-09.9.7.2 · una sola secuencia por paciente y servicio cada 30 días. */
  private async tieneSecuenciaReciente(telefono: string, servicioId: string): Promise<boolean> {
    const dias = this.configuracion.numero(CLAVE_DIAS_ENTRE, DIAS_ENTRE_SECUENCIAS);
    const desde = new Date(Date.now() - dias * 24 * 60 * 60_000);
    return (
      (await this.prisma.seguimiento.count({ where: { telefono, servicioId, creadoEn: { gte: desde } } })) > 0
    );
  }

  /** RN-09.9.7.3 · una sola secuencia activa por paciente. */
  private async tieneSecuenciaActiva(telefono: string): Promise<boolean> {
    return (await this.prisma.seguimiento.count({ where: { telefono, estado: 'programado' } })) > 0;
  }

  /**
   * ¿Hay una cita vigente de ese servicio para esa persona? Se busca por paciente
   * cuando está identificado y, si no, por teléfono: quien escribe puede no estar
   * registrado todavía.
   */
  private async yaTieneCita(
    telefono: string,
    servicioId: string,
    pacienteId?: string | null,
  ): Promise<boolean> {
    const n = await this.prisma.cita.count({
      where: {
        servicioId,
        estado: { not: 'cancelada' },
        fecha: { gte: hoyEnSede() },
        ...(pacienteId
          ? { pacienteId }
          : { paciente: { OR: [{ telefono }, { whatsapp: telefono }] } }),
      },
    });
    return n > 0;
  }

  private async optOut(pacienteId: string): Promise<boolean> {
    const p = await this.prisma.paciente.findUnique({
      where: { id: pacienteId },
      select: { noContactar: true },
    });
    return p?.noContactar === true;
  }
}
