import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { aHHMM, CONFIG, fechaEnZona } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CitasService } from '../citas/citas.service';
import { ConocimientoService } from '../conocimiento/conocimiento.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { enmascararDocumento, enmascararTelefono } from '../comun/pii';
import { HERRAMIENTAS } from './ia.herramientas';
import { promptSistema } from './ia.prompt';
import type {
  ClienteLlm, ContextoConversacion, LlamadaHerramienta, MensajeLlm, ResultadoIA,
} from './ia.tipos';

/** Tope de vueltas del loop: un bucle de herramientas no debe gastar sin fin (checklist §4). */
const MAX_TURNOS = 8;

export const CLIENTE_LLM = Symbol('CLIENTE_LLM');

/**
 * Orquestador de la IA conversacional (Arquitectura §7.3, ADR A3/A5).
 *
 * El LLM detecta intención, extrae datos y llama herramientas; nunca toca la base
 * ni decide reglas de agendamiento. Todo cupo sale del motor, que revalida al confirmar.
 */
@Injectable()
export class IaService {
  private readonly log = new Logger(IaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citas: CitasService,
    private readonly conocimiento: ConocimientoService,
    private readonly configuracion: ConfiguracionService,
    private readonly config: ConfigService,
    @Optional() @Inject(CLIENTE_LLM) private readonly llm: ClienteLlm,
  ) {}

  get disponible(): boolean {
    return this.llm?.disponible ?? false;
  }

  /**
   * Procesa un turno del paciente. Devuelve el texto a enviar y, si corresponde,
   * la orden de escalar.
   */
  async responder(ctx: ContextoConversacion, mensaje: string): Promise<ResultadoIA> {
    // Sin IA configurada no se improvisa: escala con el historial intacto.
    if (!this.disponible) {
      return {
        respuesta: 'En un momento te contacta una de nuestras asistentes.',
        escalar: { motivo: 'IA no disponible', prioridad: 'media' },
        ofrecioWeb: false,
        turnos: 0,
      };
    }

    // RN-13 · el bloque de documentación comercial se inyecta SOLO mientras la base
    // de conocimiento esté vacía. En cuanto hay artículos publicados, esa información
    // se recupera por pregunta y repetirla entera en cada conversación sería pagar
    // sus tokens para nada. Si se archivaran todos los artículos, vuelve solo.
    const kbConContenido = await this.conocimiento.hayContenidoPublicado();

    const system = promptSistema({
      urlPortal: this.config.get<string>('PORTAL_URL') ?? '',
      documentacionComercial: kbConContenido
        ? ''
        : this.configuracion.texto('documentacion_comercial', ''),
      ofrecerWeb: !ctx.yaOfrecioWeb,
      conocimientoDisponible: kbConContenido,
      primeraFechaAgendable: this.citas.primeraFechaAgendableAutoservicio(),
      ...(await this.datosDeLaVentana()),
    });

    const mensajes: MensajeLlm[] = [
      ...ctx.historial,
      { rol: 'usuario', contenido: mensaje },
    ];

    const resultado: ResultadoIA = {
      respuesta: '', ofrecioWeb: false, turnos: 0, pacienteId: ctx.pacienteId,
    };

    for (let turno = 0; turno < MAX_TURNOS; turno++) {
      resultado.turnos = turno + 1;

      let respuesta: Awaited<ReturnType<ClienteLlm['responder']>>;
      try {
        respuesta = await this.llm.responder({ system, mensajes, herramientas: HERRAMIENTAS });
      } catch (e) {
        this.log.error(`Fallo del modelo en la conversacion ${ctx.conversacionId}: ${(e as Error).message}`);
        return {
          ...resultado,
          respuesta: 'Tuve un inconveniente tecnico. Te comunico con una asistente.',
          escalar: { motivo: 'Error tecnico de la IA', prioridad: 'media' },
        };
      }

      // Un clasificador de seguridad declino el turno: no hay contenido que leer.
      if (respuesta.motivo === 'rechazo') {
        return {
          ...resultado,
          respuesta: 'Prefiero que este caso lo vea una persona. Te contactamos en un momento.',
          escalar: { motivo: 'El modelo declino responder', prioridad: 'media' },
        };
      }

      // Media frase es peor que ninguna: el paciente no sabe si lo atendieron.
      if (respuesta.motivo === 'truncado') {
        this.log.warn('El modelo agoto su presupuesto de tokens sin cerrar el turno');
        return {
          ...resultado,
          respuesta: 'Se me enredo la respuesta. Te paso con una asistente para no hacerte esperar.',
          escalar: { motivo: 'Respuesta truncada por limite de tokens', prioridad: 'media' },
        };
      }

      const texto = respuesta.texto;

      if (respuesta.motivo !== 'herramientas') {
        resultado.respuesta = texto;
        // RN-09.8 - si menciono el portal, no se vuelve a ofrecer en esta conversacion.
        const portal = this.config.get<string>('PORTAL_URL');
        if (portal && texto.includes(portal)) resultado.ofrecioWeb = true;
        return resultado;
      }

      const llamadas: LlamadaHerramienta[] = respuesta.llamadas;

      mensajes.push({ rol: 'asistente', contenido: texto, llamadas });

      for (const llamada of llamadas) {
        // Escalar corta el loop: la asistente toma la conversacion desde aqui.
        if (llamada.nombre === 'escalar_a_asistente') {
          const entrada = llamada.argumentos as unknown as { motivo: string; prioridad: 'alta' | 'media' | 'baja' };
          return {
            ...resultado,
            respuesta: texto || 'Te comunico con una de nuestras asistentes, en un momento te contactan.',
            escalar: { motivo: entrada.motivo, prioridad: entrada.prioridad },
          };
        }

        const salida = await this.ejecutar(llamada.nombre, llamada.argumentos, ctx, resultado);
        const esError = Boolean(salida && typeof salida === 'object' && 'error' in salida);

        mensajes.push({
          rol: 'herramienta',
          llamadaId: llamada.id,
          nombre: llamada.nombre,
          contenido: JSON.stringify(salida),
          ...(esError ? { esError: true } : {}),
        });
      }
    }

    // Se agotaron los turnos sin cerrar: mejor una persona que seguir gastando.
    this.log.warn(`Conversacion ${ctx.conversacionId} agoto ${MAX_TURNOS} turnos de herramientas`);
    return {
      ...resultado,
      respuesta: 'Dejame pasarte con una asistente para resolverlo mas rapido.',
      escalar: { motivo: 'La IA no cerro el caso en los turnos disponibles', prioridad: 'media' },
    };
  }

  /**
   * Ejecuta una herramienta. Cada una valida su entrada y delega en el modulo
   * correspondiente: el LLM no accede a la base directamente.
   */
  private async ejecutar(
    nombre: string,
    entrada: unknown,
    ctx: ContextoConversacion,
    resultado: ResultadoIA,
  ): Promise<unknown> {
    const args = (entrada ?? {}) as Record<string, string>;

    try {
      switch (nombre) {
        case 'buscar_paciente': {
          const documento = String(args.documento ?? '').replace(/\D/g, '');
          if (documento.length < 4) return { error: 'Documento invalido' };

          const p = await this.prisma.paciente.findUnique({
            where: { documento },
            select: { id: true, nombres: true, apellidos: true, telefono: true },
          });
          if (!p) return { encontrado: false };

          resultado.pacienteId = p.id;
          ctx.pacienteId = p.id;
          this.log.log(`IA identifico paciente doc ${enmascararDocumento(documento)}`);
          return {
            encontrado: true,
            pacienteId: p.id,
            nombres: p.nombres,
            apellidos: p.apellidos,
            telefonoRegistrado: enmascararTelefono(p.telefono),
          };
        }

        case 'registrar_paciente': {
          const documento = String(args.documento ?? '').replace(/\D/g, '');
          if (documento.length < 4) return { error: 'Documento invalido' };
          if (!args.nombres || !args.apellidos) return { error: 'Faltan nombres o apellidos' };

          const existente = await this.prisma.paciente.findUnique({ where: { documento } });
          if (existente) {
            resultado.pacienteId = existente.id;
            ctx.pacienteId = existente.id;
            return { pacienteId: existente.id, yaExistia: true };
          }

          const nuevo = await this.prisma.paciente.create({
            data: {
              documento,
              nombres: String(args.nombres).slice(0, 80),
              apellidos: String(args.apellidos).slice(0, 80),
              telefono: String(args.telefono ?? ctx.telefono).slice(0, 25),
              whatsapp: ctx.telefono,
              origen: 'whatsapp',
              sedeId: this.config.get<string>('SEDE_ID') ?? 'cdc-oriente',
            },
          });

          resultado.pacienteId = nuevo.id;
          ctx.pacienteId = nuevo.id;
          return { pacienteId: nuevo.id, yaExistia: false };
        }

        case 'listar_servicios': {
          const servicios = await this.prisma.servicio.findMany({
            where: { activo: true },
            select: { id: true, nombre: true, categoria: true, duracionMin: true, requiereOrden: true },
            orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
          });
          return { servicios };
        }

        case 'buscar_conocimiento': {
          const pregunta = String(args.pregunta ?? '').trim();
          if (pregunta.length < 2) return { error: 'Pregunta vacía' };

          const r = await this.conocimiento.buscar(pregunta, {
            servicioId: args.servicioId || undefined,
            conversacionId: ctx.conversacionId,
          });

          // Cuando la base no cubre la pregunta, la herramienta NO devuelve texto
          // que el modelo pueda parafrasear: devuelve la orden de escalar. Es la
          // diferencia entre "no sé" y una respuesta inventada (RN-13.3).
          if (r.tipo === 'bloqueada') {
            return {
              accion: 'escalar',
              motivo: `Tema que atiende una persona: ${r.tema}`,
              prioridad: 'media',
            };
          }
          if (r.tipo === 'sin_cobertura') {
            return {
              accion: 'escalar',
              motivo: 'La documentación de la clínica no cubre esta pregunta',
              prioridad: 'baja',
            };
          }

          // RN-13.7.3 · queda registrado qué sustentó la respuesta.
          resultado.kbArticulos = [...new Set(r.fragmentos.map((f) => f.articuloId))];
          resultado.kbScore = r.mejorPuntaje;

          if (args.servicioId) {
            resultado.interesServicioId = args.servicioId;
            resultado.interesComercial ??= 'medio';
          }

          return {
            accion: 'responder',
            fragmentos: r.fragmentos.map((f) => ({ titulo: f.titulo, texto: f.texto })),
            advertencia:
              'Responde SOLO con lo que digan estos fragmentos. Para cualquier cifra usa consultar_servicio.',
          };
        }

        case 'consultar_servicio': {
          const buscado = String(args.servicio ?? '').trim();
          if (!buscado) return { error: 'Falta el servicio' };

          const servicio =
            (await this.prisma.servicio.findFirst({ where: { id: buscado, activo: true } })) ??
            (await this.prisma.servicio.findFirst({
              where: { activo: true, nombre: { contains: buscado, mode: 'insensitive' } },
              orderBy: { nombre: 'asc' },
            }));

          if (!servicio) return { encontrado: false };

          // Preguntar por la ficha de un servicio agendable es interés comercial
          // (RN-09.9.1). Si además pide cupos, sube a alto más abajo.
          if (servicio.agendable) {
            resultado.interesServicioId = servicio.id;
            resultado.interesComercial ??= 'medio';
          }

          return {
            encontrado: true,
            id: servicio.id,
            nombre: servicio.nombre,
            duracionMin: servicio.duracionMin,
            cupos: servicio.cupos,
            requiereOrden: servicio.requiereOrden,
            politicaCosto: servicio.politicaCosto,
            rangoPrecio: servicio.rangoPrecio,
            descripcion: servicio.descripcionComercial,
            beneficios: servicio.beneficios,
            preparacion: servicio.preparacion,
            // RN-13.9 · si no es agendable por chat, el ofrecimiento no es un horario.
            agendable: servicio.agendable,
          };
        }

        case 'ofrecer_cupos': {
          // RN-09.8 - pedir cupos ES la intencion de agendar.
          resultado.ofrecioWeb = true;
          // RN-09.9.1 · y es el interés más claro que puede haber.
          resultado.interesServicioId = String(args.servicioId);
          resultado.interesComercial = 'alto';

          const cupos = await this.citas.cupos({
            servicioId: String(args.servicioId),
            fecha: String(args.fecha),
            prestadorId: args.prestadorId || undefined,
            limite: 6,
            // RN-10.5 · con el paciente identificado el motor puede decir «ya tienes
            // cita ese día» antes de que el modelo le negocie una hora imposible.
          } as never, { autoservicio: true, pacienteId: ctx.pacienteId ?? undefined });

          return {
            cupos: cupos.map((c) => ({
              hora: c.hora,
              prestadorId: c.prestadorId,
              prestador: c.prestadorNombre,
              duracionMin: c.duracionMin,
            })),
            // Que el modelo no confunda "no hay" con un error.
            sinDisponibilidad: cupos.length === 0,
            ...(cupos.length === 0
              ? await this.motivoDelVacio(String(args.servicioId), String(args.fecha), args.prestadorId || undefined)
              : {}),
          };
        }

        case 'confirmar_cita': {
          const pacienteId = args.pacienteId || ctx.pacienteId;
          if (!pacienteId) return { error: 'Primero identifica al paciente' };

          const r = await this.citas.crearConAlternativas(
            {
              pacienteId,
              servicioId: String(args.servicioId),
              fecha: String(args.fecha),
              hora: String(args.hora),
              prestadorId: String(args.prestadorId),
              origen: 'whatsapp',
            } as never,
            'ia',
            // RN-04.6 · el paciente agenda solo por WhatsApp: no puede tomar cupos de hoy.
            // RN-10.5 · y una sola cita por día: para otra, que llame.
            { autoservicio: true, pacienteId },
          );

          if (!r.creada) {
            return {
              creada: false,
              motivo: r.motivo,
              alternativas: r.alternativas.map((c) => ({
                hora: c.hora, prestador: c.prestadorNombre, prestadorId: c.prestadorId,
              })),
            };
          }

          resultado.citaCreada = { codigo: r.cita.codigo };
          return {
            creada: true,
            codigo: r.cita.codigo,
            fecha: String(args.fecha),
            hora: String(args.hora),
            prestador: r.cita.prestador.nombre,
            servicio: r.cita.servicio.nombre,
          };
        }

        case 'consultar_citas': {
          const pacienteId = args.pacienteId || ctx.pacienteId;
          if (!pacienteId) return { error: 'Primero identifica al paciente' };

          const hoy = new Date(`${fechaEnZona()}T00:00:00Z`);
          const citas = await this.prisma.cita.findMany({
            where: { pacienteId, fecha: { gte: hoy }, estado: { notIn: ['cancelada', 'atendida'] } },
            include: { prestador: true, servicio: true },
            orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
            take: 5,
          });

          return {
            citas: citas.map((c) => ({
              citaId: c.id,
              codigo: c.codigo,
              fecha: c.fecha.toISOString().slice(0, 10),
              hora: aHHMM(c.horaInicio),
              servicio: c.servicio.nombre,
              prestador: c.prestador.nombre,
            })),
          };
        }

        case 'cancelar_cita': {
          const cita = await this.prisma.cita.findUnique({ where: { id: String(args.citaId) } });
          // Un paciente no puede cancelar la cita de otro, aunque el modelo lo pida.
          if (!cita || (ctx.pacienteId && cita.pacienteId !== ctx.pacienteId)) {
            return { error: 'Cita no encontrada' };
          }

          await this.citas.cancelar(cita.id, { motivo: String(args.motivo ?? 'Solicitud del paciente') }, 'ia');
          return { cancelada: true, codigo: cita.codigo };
        }

        default:
          return { error: `Herramienta desconocida: ${nombre}` };
      }
    } catch (e) {
      const mensaje = (e as Error).message;
      this.log.warn(`Herramienta ${nombre} fallo: ${mensaje}`);
      // El motor rechaza por regla de negocio (RN-01 a RN-04): el modelo debe verlo
      // para poder ofrecer alternativas, no para reinterpretarlo.
      return { error: mensaje };
    }
  }

  /**
   * RN-04.8 · La ventana vigente, como DATO para el prompt.
   *
   * Datos y no reglas: escribir la tabla de siete filas en el prompt la convertiría en
   * una sugerencia que el modelo puede reinterpretar. La invariante vive en el motor,
   * que rechaza la fecha y la hora aunque el modelo las pida igual.
   */
  private async datosDeLaVentana(): Promise<{
    fechasAgendables: string[] | null; horarioAgendable: string | null;
  }> {
    const v = await this.citas.ventanaDeAutoservicio();
    if (!v) return { fechasAgendables: null, horarioAgendable: null };

    const cubreElDia = v.horarioCita.desde === 0 && v.horarioCita.hasta >= 1439;
    return {
      fechasAgendables: v.fechas,
      // Una franja de día entero no es una restricción: decirla solo añade ruido.
      horarioAgendable: cubreElDia ? null : `${aHHMM(v.horarioCita.desde)} a ${aHHMM(v.horarioCita.hasta)}`,
    };
  }

  /**
   * RN-04.8 · Por qué la lista salió vacía, cuando la respuesta honesta no es «no hay».
   *
   * Con la franja horaria del autoservicio, un día con agenda entera de mañana no
   * devuelve un solo cupo por este canal. Decirle al modelo solo `sinDisponibilidad`
   * hace que le prometa al paciente que la agenda está llena, que es falso: los cupos
   * existen, no son para este canal. Es la misma mentira que el portal dejó de contar.
   *
   * Se comprueba repitiendo la MISMA consulta sin la marca de autoservicio. Lo único
   * que cambia entre las dos es el filtro horario: las demás reglas del canal —el día
   * no laborable, la ventana, la anticipación, una cita por día— **lanzan** en vez de
   * filtrar, así que si se llegó hasta aquí es que ya pasaron todas. Por eso el sondeo
   * es exacto y no una aproximación, y por eso solo se paga cuando la lista viene vacía.
   */
  private async motivoDelVacio(
    servicioId: string, fecha: string, prestadorId?: string,
  ): Promise<{ motivoSinDisponibilidad: string } | Record<string, never>> {
    const ventana = await this.citas.ventanaDeAutoservicio();
    if (!ventana) return {};

    const desde = aHHMM(ventana.horarioCita.desde);
    const hasta = aHHMM(ventana.horarioCita.hasta);
    /*
     * Atajo, NO una guarda de corrección: con la franja abierta el sondeo devolvería lo
     * mismo que la consulta filtrada —cero— y se saldría por el `return` de abajo. Se
     * comprobó mutándolo, y ninguna prueba cae. Está por lo que ahorra: una consulta de
     * cupos por cada día sin disponibilidad, en el camino caliente del bot.
     */
    if (ventana.horarioCita.desde === 0 && ventana.horarioCita.hasta >= 1439) return {};

    const sinFiltro = await this.citas.cupos(
      { servicioId, fecha, prestadorId, limite: 1 } as never,
    );
    if (sinFiltro.length === 0) return {};

    return {
      motivoSinDisponibilidad:
        `Ese dia SI hay agenda, pero por este canal solo se reservan citas entre las ${desde} y las ${hasta}. `
        + 'Diselo asi al paciente y ofrecele que una asistente le coordine un horario de manana.',
    };
  }

  /** Umbral de confianza configurable (RN-08.2, Arquitectura §7.3). */
  umbralConfianza(): number {
    return this.configuracion.numero(CONFIG.UMBRAL_CONFIANZA_IA, 70);
  }
}
