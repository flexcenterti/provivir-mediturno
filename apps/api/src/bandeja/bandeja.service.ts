import {
  BadGatewayException, BadRequestException, ConflictException, Injectable, Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { existsSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { finDelDiaEnZona, inicioDelDiaEnZona, SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { TurnosGateway } from '../turnos/turnos.gateway';
import { ConversacionService } from '../whatsapp/conversacion.service';
import { FueraDeVentanaMeta, MetaCliente } from '../whatsapp/meta.cliente';
import { VentanaService } from '../whatsapp/ventana.service';
import { mimeDeExtension } from '../whatsapp/media.tipos';
import {
  CLAVE_PLANTILLA_CONTACTO, CLAVE_PLANTILLA_REAPERTURA, parametrosReapertura,
} from '../whatsapp/whatsapp.plantillas';
import { esTelefono, normalizarIdentidad, variantesDeTelefono } from '../whatsapp/whatsapp.normalizador';
import { numeroDeContacto } from '../comun/contacto';
import { armarPagina } from '../comun/paginacion';
import { esperaEnMinutos, ordenarPendientes } from './bandeja.orden';
import { PENDIENTES } from './bandeja.filtros';
import type { BuscarBandejaDto } from './dto/bandeja.dto';

/** Cómo terminó el intento de mandar una plantilla. Cada llamante decide qué hacer. */
type ResultadoPlantilla =
  | { estado: 'enviada'; plantilla: string }
  | { estado: 'sin_configurar' }
  | { estado: 'ya_enviada' };

const PACIENTE_RESUMIDO = {
  select: { id: true, nombres: true, apellidos: true, documento: true },
} as const;

/** Solo el nombre: la bandeja necesita saber quién atiende, no su ficha. */
const ASISTENTE = { select: { id: true, nombre: true } } as const;

/**
 * Bandeja de la asistente (RN-08.3, Especificación §2.9).
 *
 * Muestra motivo, prioridad, tiempo esperando e historial. La asistente toma la
 * conversación y responde por WhatsApp desde la plataforma.
 */
@Injectable()
export class BandejaService {
  private readonly log = new Logger(BandejaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversaciones: ConversacionService,
    private readonly auditoria: AuditoriaService,
    private readonly gateway: TurnosGateway,
    private readonly config: ConfigService,
    private readonly configuracion: ConfiguracionService,
    private readonly ventana: VentanaService,
    private readonly meta: MetaCliente,
  ) {}

  /**
   * RN-05.3 · mientras el cliente no defina los criterios de prioridad (P4), la
   * columna operativa dominante es el TIEMPO DE ESPERA. Por eso los pendientes van
   * por prioridad y, dentro de ella, quien lleva más esperando primero.
   *
   * El histórico no: en una conversación cerrada la prioridad ya no significa nada,
   * así que se ordena por cuándo se cerró y se pagina de verdad contra la base.
   */
  async listar(dto: BuscarBandejaDto) {
    const where = this.filtro(dto);
    const include = {
      paciente: PACIENTE_RESUMIDO,
      asistente: ASISTENTE,
      mensajes: { orderBy: { ts: 'desc' }, take: 1 },
    } satisfies Prisma.ConversacionInclude;

    if (dto.vista === 'pendientes') {
      // Ordenar por prioridad y espera exige materializar los minutos, que no son
      // una columna. Son decenas de filas: se traen y se ordenan en memoria.
      const filas = await this.prisma.conversacion.findMany({ where, include });
      const ordenadas = ordenarPendientes(filas.map((c) => this.resumir(c)));
      return armarPagina(
        ordenadas.slice(dto.salto, dto.salto + dto.porPagina),
        ordenadas.length,
        dto,
      );
    }

    const orderBy: Prisma.ConversacionOrderByWithRelationInput =
      dto.vista === 'cerradas' ? { resueltaTs: 'desc' } : { creadoEn: 'desc' };

    const [filas, total] = await Promise.all([
      this.prisma.conversacion.findMany({
        where, include, orderBy, skip: dto.salto, take: dto.porPagina,
      }),
      this.prisma.conversacion.count({ where }),
    ]);

    return armarPagina(filas.map((c) => this.resumir(c)), total, dto);
  }

  private filtro(dto: BuscarBandejaDto): Prisma.ConversacionWhereInput {
    const condiciones: Prisma.ConversacionWhereInput[] = [];

    if (dto.vista === 'pendientes') condiciones.push(PENDIENTES);
    if (dto.vista === 'cerradas') condiciones.push({ resueltaTs: { not: null } });

    const texto = dto.q?.trim();
    if (texto) {
      const digitos = texto.replace(/\D/g, '');
      const o: Prisma.ConversacionWhereInput[] = [
        { paciente: { nombres: { contains: texto, mode: 'insensitive' } } },
        { paciente: { apellidos: { contains: texto, mode: 'insensitive' } } },
        { paciente: { documento: { contains: texto, mode: 'insensitive' } } },
      ];
      /*
       * Se busca por subcadena de dígitos en vez de con `variantesDeTelefono()`:
       * esa función espera un identificador ya normalizado, y con texto libre mete
       * la cadena vacía entre las variantes — `telefono IN ('')` casaría con
       * cualquier conversación sin número.
       */
      if (digitos.length >= 3) o.push({ telefono: { contains: digitos } });
      condiciones.push({ OR: o });
    }

    // El histórico se busca por cuándo se cerró; lo demás, por cuándo empezó.
    const campo = dto.vista === 'cerradas' ? 'resueltaTs' : 'creadoEn';
    if (dto.desde) condiciones.push({ [campo]: { gte: inicioDelDiaEnZona(dto.desde) } });
    // `finDelDiaEnZona` es el inicio del día siguiente: el límite es `<`, así que
    // `hasta` queda incluido entero sin jugar con milisegundos.
    if (dto.hasta) condiciones.push({ [campo]: { lt: finDelDiaEnZona(dto.hasta) } });

    return condiciones.length > 0 ? { AND: condiciones } : {};
  }

  private resumir(c: Prisma.ConversacionGetPayload<{
    include: {
      paciente: typeof PACIENTE_RESUMIDO;
      asistente: typeof ASISTENTE;
      mensajes: true;
    };
  }>) {
    return {
      id: c.id,
      telefono: c.telefono,
      paciente: c.paciente,
      motivo: c.motivo,
      prioridad: c.prioridad,
      intencion: c.intencion,
      tomadaPor: c.tomadaPor,
      /** Quién la atiende, con nombre: con el id suelto solo se podía decir "En gestión". */
      asistente: c.asistente,
      estado: c.estado,
      resueltaTs: c.resueltaTs,
      reabiertaTs: c.reabiertaTs,
      reaperturas: c.reaperturas,
      // RN-08.3 · para que la espera "no se vuelva paisaje".
      minutosEsperando: esperaEnMinutos(c),
      ultimoMensaje: c.mensajes[0]?.contenido ?? null,
    };
  }

  async conteoPendientes(): Promise<number> {
    return this.prisma.conversacion.count({ where: PENDIENTES });
  }

  /** Historial completo, con la media adjunta que el paciente envió (RN-09.2). */
  async detalle(id: string) {
    const conversacion = await this.prisma.conversacion.findUnique({
      where: { id },
      include: {
        paciente: true,
        asistente: ASISTENTE,
        mensajes: { orderBy: { ts: 'asc' }, include: { autor: ASISTENTE } },
      },
    });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');

    return {
      ...conversacion,
      minutosEsperando: esperaEnMinutos(conversacion),
      /**
       * Lo que decide si se puede escribir. Va en el detalle para que la interfaz lo
       * diga ANTES de que la asistente redacte: enterarse al pulsar enviar es
       * enterarse tarde.
       */
      ventana: await this.estadoDeVentana(conversacion.telefono),
    };
  }

  private async estadoDeVentana(telefono: string) {
    const { dentro, ultimoEntranteTs, expiraTs } = await this.ventana.estado(telefono);
    return {
      dentro,
      ultimoEntranteTs,
      expiraTs,
      plantillaConfigurada: this.nombrePlantillaReapertura() !== '',
    };
  }

  private nombrePlantillaReapertura(): string {
    return this.configuracion.texto(CLAVE_PLANTILLA_REAPERTURA, '').trim();
  }

  /**
   * Abre —o recupera— la conversación de un paciente, y le manda la plantilla que le
   * pide que conteste.
   *
   * Nace de que quien agenda por el portal no deja hilo: solo lo crea un mensaje
   * entrante del webhook, así que a ese paciente no había forma de escribirle. Aquí
   * lo crea una persona cuando decide que hace falta, y NO el portal al agendar: un
   * hilo por cada agendamiento web llenaría la bandeja de conversaciones que nadie
   * pidió, y la bandeja es para lo que necesita a alguien.
   *
   * Responde 200 con el desenlace en vez de 409, y no por comodidad: `pedir()` en el
   * cliente se queda con `message` y tira el resto del cuerpo, así que un 409 con el
   * id del hilo dentro es inalcanzable desde la interfaz — deja a la asistente con un
   * error rojo y ningún sitio al que ir. Y como la acción siguiente es siempre la
   * misma, abrir el hilo, tampoco era un error.
   */
  async abrir(pacienteId: string, citaId: string | undefined, usuarioId: string) {
    const paciente = await this.prisma.paciente.findUnique({
      where: { id: pacienteId },
      select: { id: true, nombres: true, whatsapp: true, telefono: true },
    });
    if (!paciente) throw new NotFoundException('Paciente no encontrado');

    const crudo = numeroDeContacto(paciente);
    /*
     * `normalizarIdentidad` a la entrada, igual que hace el webhook con lo que manda
     * Meta. El portal guarda lo que teclee el paciente —`3009991111`—, así que sin
     * esto el hilo nacería en un formato y su respuesta llegaría en otro: se abriría
     * un segundo hilo y la asistente se quedaría mirando el suyo, vacío.
     */
    const telefono = crudo ? normalizarIdentidad(crudo) : null;
    if (!telefono || !esTelefono(telefono)) {
      // Antes de escribir nada: un hilo con `telefono: ''` casaría con cualquier otro
      // paciente sin número y les mezclaría las conversaciones.
      throw new BadRequestException(
        'Este paciente no tiene un número de WhatsApp válido. Corrígelo en su ficha.',
      );
    }

    let motivo = 'Contacto iniciado por una asistente';
    if (citaId) {
      const cita = await this.prisma.cita.findUnique({
        where: { id: citaId },
        select: { codigo: true, pacienteId: true },
      });
      // Sin esta comprobación se estamparía el código de la cita de otro en el motivo.
      if (!cita || cita.pacienteId !== pacienteId) {
        throw new BadRequestException('Esa cita no es de este paciente');
      }
      motivo = `Contacto iniciado por una asistente · cita ${cita.codigo}`;
    }

    const { conversacionId, creada, reabierta } = await this.asegurarConversacion(
      pacienteId, telefono, motivo, usuarioId,
    );

    /*
     * La plantilla va FUERA de la transacción: nunca se sostiene un lock de base
     * durante una llamada HTTP a Meta.
     *
     * Y con la ventana abierta no se manda: significa que el paciente escribió hace
     * poco, así que cabe texto libre. Las plantillas se pagan y Meta penaliza usarlas
     * donde no hacen falta.
     */
    const ventana = await this.ventana.estado(telefono);
    if (ventana.dentro) {
      return { conversacionId, creada, reabierta, plantilla: 'ventana_abierta' as const };
    }

    let plantilla: 'enviada' | 'sin_configurar' | 'ya_enviada';
    try {
      const r = await this.mandarPlantilla({
        conversacionId,
        telefono,
        clave: CLAVE_PLANTILLA_CONTACTO,
        parametros: parametrosReapertura(paciente.nombres),
        usuarioId,
        etiqueta: 'Plantilla de contacto inicial',
      });
      plantilla = r.estado;
    } catch (e) {
      /*
       * El hilo se creó antes de enviar, y se queda. Es el mismo razonamiento que ya
       * estaba escrito en `responder()`: un hilo vacío con su motivo y su auditoría,
       * que la asistente ve y puede resolver, es mejor que un mensaje enviado sin
       * hilo donde conste que alguien lo intentó.
       */
      await this.auditoria.registrar({
        usuario: usuarioId,
        accion: 'Plantilla de contacto inicial no enviada',
        entidad: `conversacion/${conversacionId}`,
        detalle: `WhatsApp rechazó el envío: ${(e as Error).message.slice(0, 300)}`,
      });
      throw new BadGatewayException(
        'La conversación quedó abierta en la bandeja, pero WhatsApp rechazó el mensaje.',
      );
    }

    return { conversacionId, creada, reabierta, plantilla };
  }

  /**
   * Un solo hilo vivo por número, pase lo que pase.
   *
   * El lock consultivo serializa de verdad: la comprobación dentro de la transacción
   * que usa `reabrir` es *best effort*, porque en READ COMMITTED no impide un INSERT
   * concurrente — y no hay índice único que lo impida. Dos asistentes pulsando a la
   * vez, o el paciente escribiendo justo entonces, partirían la conversación en dos.
   *
   * Si solo hay hilos cerrados se REABRE el más reciente en vez de crear uno al lado,
   * por lo mismo que argumenta `reabrir`: lo que se quiere es continuidad, y así
   * `obtenerOCrear` vuelve a encontrarlo cuando el paciente responda.
   */
  private async asegurarConversacion(
    pacienteId: string, telefono: string, motivo: string, usuarioId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`conversacion:${telefono}`}))`;

      const variantes = variantesDeTelefono(telefono);
      const viva = await tx.conversacion.findFirst({
        where: { telefono: { in: variantes }, resueltaTs: null },
        orderBy: { creadoEn: 'desc' },
        select: { id: true, tomadaPor: true, asistente: { select: { nombre: true } } },
      });
      if (viva) {
        /*
         * Si ya la tiene otra persona no se sigue: `mandarPlantilla` pone `tomadaPor`
         * a nombre de quien envía, así que continuar le arrebataría la conversación a
         * quien la está atendiendo, y en silencio. Es la misma guarda que `tomar()`, y
         * con el nombre por el mismo motivo: «otra asistente» obliga a preguntar por
         * el pasillo quién es.
         */
        if (viva.tomadaPor && viva.tomadaPor !== usuarioId) {
          throw new ConflictException(
            `${viva.asistente?.nombre ?? 'Otra asistente'} ya está atendiendo esta conversación`,
          );
        }
        return { conversacionId: viva.id, creada: false, reabierta: false };
      }

      const cerrada = await tx.conversacion.findFirst({
        where: { telefono: { in: variantes } },
        orderBy: { resueltaTs: 'desc' },
        select: { id: true },
      });

      if (cerrada) {
        await tx.conversacion.update({
          where: { id: cerrada.id },
          data: {
            resueltaTs: null,
            reabiertaTs: new Date(),
            reaperturas: { increment: 1 },
            estado: 'en_gestion',
            tomadaPor: usuarioId,
            motivo,
          },
        });
        return { conversacionId: cerrada.id, creada: false, reabierta: true };
      }

      const nueva = await tx.conversacion.create({
        data: {
          telefono,
          // A diferencia del webhook, aquí SÍ se sabe quién es: la bandeja muestra su
          // nombre y su documento en vez de un número suelto.
          pacienteId,
          estado: 'en_gestion',
          tomadaPor: usuarioId,
          // Lo que la hace visible en «pendientes» sin tocar `escalada`, que es métrica.
          iniciadaTs: new Date(),
          motivo,
          sedeId: this.config.get<string>('SEDE_ID') ?? SEDE_ID,
        },
        select: { id: true },
      });
      return { conversacionId: nueva.id, creada: true, reabierta: false };
    });
  }

  async tomar(id: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({
      where: { id },
      include: { asistente: ASISTENTE },
    });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');
    if (conversacion.tomadaPor && conversacion.tomadaPor !== usuarioId) {
      // Con nombre: "otra asistente" obliga a preguntar por el pasillo quién es.
      throw new ConflictException(
        `${conversacion.asistente?.nombre ?? 'Otra asistente'} ya está atendiendo esta conversación`,
      );
    }

    const actualizada = await this.prisma.conversacion.update({
      where: { id },
      data: { tomadaPor: usuarioId, estado: 'en_gestion' },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Conversación tomada',
      entidad: `conversacion/${id}`,
      estadoPrev: conversacion.estado,
      estadoNext: 'en_gestion',
    });

    this.gateway.emitirPendientesBandeja(await this.conteoPendientes());
    return actualizada;
  }

  /**
   * Devuelve la conversación a la bandeja.
   *
   * Sin esto, quien toma un hilo y se va a almorzar lo deja bloqueado para todas las
   * demás: `tomar()` rechaza a cualquier otra persona y no había forma de soltarlo.
   * Vuelve a `escalada` y no a `ia_activa` porque sigue necesitando a una persona;
   * devolvérsela al bot sería otra decisión, y no la que se pidió.
   */
  async soltar(id: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({ where: { id } });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');
    if (conversacion.resueltaTs) throw new BadRequestException('La conversación está cerrada');
    if (!conversacion.tomadaPor) return conversacion;

    const soltada = await this.prisma.conversacion.update({
      where: { id },
      data: { tomadaPor: null, estado: 'escalada' },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Conversación devuelta a la bandeja',
      entidad: `conversacion/${id}`,
      estadoPrev: conversacion.estado,
      estadoNext: 'escalada',
    });

    this.gateway.emitirPendientesBandeja(await this.conteoPendientes());
    return soltada;
  }

  /**
   * Reabre una conversación cerrada para poder seguir atendiéndola.
   *
   * Se reabre la MISMA fila (`resueltaTs: null`) en vez de crear una nueva enlazada:
   * lo que se quiere es continuidad, y así `obtenerOCrear` vuelve a encontrar este
   * hilo si el paciente responde, sin tocar el camino caliente del webhook.
   *
   * Queda `en_gestion` y a nombre de quien la reabre: el bot corta en ese estado, y
   * reabrir es un acto deliberado —quien reabre es quien va a atender—. Si volviera a
   * `ia_activa`, el bot y la persona contestarían a la vez sobre el mismo hilo.
   *
   * `escalada` y `escaladaTs` NO se tocan: alimentan las métricas, que se calculan
   * sobre el estado actual, y pisarlas reescribiría meses ya reportados.
   *
   * No rearma el seguimiento comercial, y es lo correcto: se cancela cuando hay
   * `tomadaPor`, que es justo lo que esto pone. Si hay una persona hablando, la
   * plataforma no le escribe encima.
   *
   * Reabrir NO depende de la ventana de 24 h. La ventana decide qué se puede enviar,
   * no si se puede retomar: atarlas dejaría conversaciones imposibles de recuperar.
   */
  async reabrir(id: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({ where: { id } });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');
    if (!conversacion.resueltaTs) {
      throw new BadRequestException('La conversación no está cerrada');
    }

    const reabierta = await this.prisma.$transaction(async (tx) => {
      /*
       * El paciente pudo escribir entre la lectura y esta escritura, y entonces ya
       * existe un hilo vivo para su número. Reabrir aquí dejaría dos conversaciones
       * sin resolver y el historial partido en dos sin que nadie se entere.
       */
      const viva = await tx.conversacion.findFirst({
        where: {
          id: { not: id },
          telefono: { in: variantesDeTelefono(conversacion.telefono) },
          resueltaTs: null,
        },
        select: { id: true },
      });
      if (viva) {
        throw new ConflictException({
          message: 'El paciente ya tiene una conversación abierta',
          conversacionId: viva.id,
        });
      }

      return tx.conversacion.update({
        where: { id },
        data: {
          resueltaTs: null,
          estado: 'en_gestion',
          tomadaPor: usuarioId,
          reabiertaTs: new Date(),
          reaperturas: { increment: 1 },
        },
      });
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Conversación reabierta',
      entidad: `conversacion/${id}`,
      // El dato que `reabiertaTs` desplaza: sin esto se pierde cuándo se había
      // cerrado y cuánto se esperó la primera vez.
      detalle:
        `Cerrada el ${conversacion.resueltaTs.toISOString()}` +
        (conversacion.escaladaTs
          ? ` · escalada el ${conversacion.escaladaTs.toISOString()}`
          : '') +
        ` · reapertura n.º ${reabierta.reaperturas}`,
      estadoPrev: 'resuelta',
      estadoNext: 'en_gestion',
    });

    this.gateway.emitirPendientesBandeja(await this.conteoPendientes());
    return reabierta;
  }

  /**
   * La asistente responde por WhatsApp sin salir de la plataforma (RN-08.3).
   *
   * El orden importa: se comprueba la ventana, se toma la conversación y solo
   * entonces se envía. Antes se tomaba DESPUÉS de enviar, así que un envío fallido
   * dejaba la conversación sin dueño y sin rastro de que alguien la había intentado.
   */
  async responder(id: string, texto: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({ where: { id } });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');
    if (conversacion.resueltaTs) {
      throw new ConflictException('La conversación está cerrada: reábrela para responder');
    }

    const ventana = await this.estadoDeVentana(conversacion.telefono);
    if (!ventana.dentro) throw this.ventanaCerrada(conversacion.id, ventana, usuarioId);

    if (!conversacion.tomadaPor) {
      await this.prisma.conversacion.update({
        where: { id },
        data: { tomadaPor: usuarioId, estado: 'en_gestion' },
      });
    }

    try {
      await this.conversaciones.enviar(id, conversacion.telefono, texto, undefined, usuarioId);
    } catch (e) {
      // La comprobación previa pudo desincronizarse: un entrante todavía en la cola,
      // un desfase de reloj. Que el aviso siga diciendo qué hacer.
      if (e instanceof FueraDeVentanaMeta) throw this.ventanaCerrada(conversacion.id, ventana, usuarioId);
      throw e;
    }

    return { enviado: true };
  }

  /**
   * Un 409 con la salida concreta, no un 500 con el error crudo de Meta.
   *
   * Se registra en auditoría igual que un recordatorio descartado: el mensaje no
   * salió, y eso tiene que poder investigarse cuando el paciente diga que nunca le
   * contestaron.
   */
  private ventanaCerrada(
    conversacionId: string,
    ventana: { plantillaConfigurada: boolean },
    usuarioId: string,
  ): ConflictException {
    const motivo = ventana.plantillaConfigurada
      ? 'La ventana de 24 h de WhatsApp está cerrada. Envía la plantilla aprobada para que el paciente pueda responder.'
      : 'La ventana de 24 h de WhatsApp está cerrada y no hay plantilla configurada. Configúrala en Administración → Reglas.';

    void this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Respuesta no enviada',
      entidad: `conversacion/${conversacionId}`,
      detalle: 'Fuera de la ventana de 24 h de Meta',
    });

    return new ConflictException({ message: motivo, plantillaConfigurada: ventana.plantillaConfigurada });
  }

  /**
   * Manda la plantilla aprobada que le pide al paciente que responda.
   *
   * La plantilla NO abre la ventana: solo la abre la respuesta del paciente. Es lo
   * único que Meta acepta cuando ya se cerró, y sirve para pedir esa respuesta.
   */
  async enviarPlantillaReapertura(id: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({
      where: { id },
      include: { paciente: { select: { nombres: true } } },
    });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');

    const ventana = await this.ventana.estado(conversacion.telefono);
    if (ventana.dentro) {
      // Las plantillas se pagan, y Meta penaliza usarlas donde vale el texto libre.
      throw new ConflictException('La ventana está abierta: responde con un mensaje normal');
    }

    const r = await this.mandarPlantilla({
      conversacionId: id,
      telefono: conversacion.telefono,
      clave: CLAVE_PLANTILLA_REAPERTURA,
      parametros: parametrosReapertura(conversacion.paciente?.nombres ?? null),
      usuarioId,
      etiqueta: 'Plantilla de reapertura',
    });

    if (r.estado === 'sin_configurar') {
      throw new ConflictException(
        'No hay plantilla de reapertura configurada. Se define en Administración → Reglas con el nombre aprobado en Meta.',
      );
    }
    if (r.estado === 'ya_enviada') {
      throw new ConflictException('Ya se le envió una plantilla en las últimas 24 h');
    }
    return { enviado: true, plantilla: r.plantilla };
  }

  /**
   * Manda una plantilla aprobada y deja la conversación a nombre de quien la mandó.
   *
   * Lo comparten reabrir un hilo cerrado y abrir uno nuevo: son el mismo acto —pedirle
   * al paciente que conteste, que es lo único que abre la ventana— sobre plantillas
   * distintas. Devuelve el desenlace en vez de lanzar porque los dos llamantes lo
   * traducen distinto: para la reapertura «no hay plantilla» es un 409, y para la
   * apertura es parte de la respuesta.
   */
  private async mandarPlantilla(o: {
    conversacionId: string;
    telefono: string;
    clave: string;
    parametros: string[];
    usuarioId: string;
    etiqueta: string;
  }): Promise<ResultadoPlantilla> {
    const plantilla = this.configuracion.texto(o.clave, '').trim();
    if (!plantilla) {
      // Sin plantilla no se intenta: Meta lo rechazaría y reintentar no cambia nada.
      await this.auditoria.registrar({
        usuario: o.usuarioId,
        accion: `${o.etiqueta} no enviada`,
        entidad: `conversacion/${o.conversacionId}`,
        detalle: `Sin nombre en la configuración ${o.clave}`,
      });
      return { estado: 'sin_configurar' };
    }

    /*
     * Una plantilla al día POR NÚMERO, no por conversación: si el paciente no contesta
     * a la primera, insistir no lo cambia y a Meta le consta como spam — y Meta cuenta
     * por interlocutor, no por fila de nuestra base. Filtrando por `conversacionId` la
     * guarda se burlaba sin querer: mandar plantilla, resolver el hilo y volver a
     * abrirlo daba una conversación nueva con la guarda vacía.
     */
    const yaEnviada = await this.prisma.mensaje.findFirst({
      where: {
        conversacion: { telefono: { in: variantesDeTelefono(o.telefono) } },
        direccion: 'saliente',
        tipo: 'plantilla',
        ts: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      },
      select: { id: true },
    });
    if (yaEnviada) return { estado: 'ya_enviada' };

    const waMessageId = await this.meta.enviarPlantilla(o.telefono, plantilla, o.parametros);

    await this.prisma.$transaction([
      this.prisma.mensaje.create({
        data: {
          conversacionId: o.conversacionId,
          direccion: 'saliente',
          tipo: 'plantilla',
          contenido: `Plantilla «${plantilla}»`,
          waMessageId: waMessageId || null,
          autorId: o.usuarioId,
        },
      }),
      // Quien manda la plantilla, atiende: es quien espera la respuesta.
      this.prisma.conversacion.update({
        where: { id: o.conversacionId },
        data: { tomadaPor: o.usuarioId, estado: 'en_gestion' },
      }),
    ]);

    await this.auditoria.registrar({
      usuario: o.usuarioId,
      accion: `${o.etiqueta} enviada`,
      entidad: `conversacion/${o.conversacionId}`,
      detalle: `Plantilla ${plantilla}`,
    });

    this.gateway.emitirPendientesBandeja(await this.conteoPendientes());
    return { estado: 'enviada', plantilla };
  }

  async resolver(id: string, usuarioId: string) {
    const conversacion = await this.prisma.conversacion.findUnique({ where: { id } });
    if (!conversacion) throw new NotFoundException('Conversación no encontrada');

    const resuelta = await this.prisma.conversacion.update({
      where: { id },
      data: { estado: 'resuelta', resueltaTs: new Date() },
    });

    const desde = conversacion.reabiertaTs ?? conversacion.escaladaTs;
    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Conversación resuelta',
      entidad: `conversacion/${id}`,
      detalle: desde
        ? `Atendida tras ${esperaEnMinutos(conversacion)} min de espera`
        : undefined,
      estadoPrev: conversacion.estado,
      estadoNext: 'resuelta',
    });

    this.gateway.emitirPendientesBandeja(await this.conteoPendientes());
    return resuelta;
  }

  /**
   * RN-08.1 · el adjunto es el soporte con el que trabaja la asistente. Si la orden
   * médica escaneada no se puede abrir, el escalamiento no sirve de nada: ve la
   * referencia al documento y sigue sin poder atender.
   *
   * La ruta NUNCA llega del cliente. Se direcciona por id de mensaje y sale de la base
   * de datos, así que la travesía de rutas no es posible por construcción; la
   * comprobación contra DIR_MEDIA es defensa en profundidad por si un valor almacenado
   * se corrompiera.
   */
  async mediaDeMensaje(mensajeId: string, usuarioId: string) {
    const mensaje = await this.prisma.mensaje.findUnique({
      where: { id: mensajeId },
      select: { id: true, conversacionId: true, tipo: true, contenido: true, mediaPath: true },
    });
    if (!mensaje?.mediaPath) throw new NotFoundException('El mensaje no tiene adjunto');

    const raiz = resolve(this.config.get<string>('DIR_MEDIA') || 'media');
    const ruta = resolve(mensaje.mediaPath);
    if (!ruta.startsWith(raiz + sep)) {
      this.log.error(`Adjunto fuera de DIR_MEDIA: mensaje ${mensajeId}`);
      throw new NotFoundException('Adjunto no disponible');
    }

    if (!existsSync(ruta)) {
      // Consta en la conversación pero no está en disco: es un incidente operativo,
      // no un 404 cualquiera, y tiene que poder investigarse.
      this.log.warn(`Adjunto ausente en disco: mensaje ${mensajeId} · ${basename(ruta)}`);
      throw new NotFoundException('Adjunto no disponible');
    }

    // Es un dato del paciente: queda trazado quién lo abrió (auditoría append-only).
    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Adjunto consultado',
      entidad: `mensaje/${mensajeId}`,
      detalle: `Conversación ${mensaje.conversacionId} · ${mensaje.tipo}`,
    });

    return {
      ruta,
      contentType: mimeDeExtension(ruta),
      nombreDescarga: nombreSeguro(mensaje.contenido) ?? basename(ruta),
    };
  }
}

/**
 * El nombre que muestra WhatsApp lo escribe el paciente, así que no puede ir tal cual
 * a una cabecera: un salto de línea o una comilla dentro del `Content-Disposition`
 * permitiría inyectar cabeceras. Se queda solo lo imprimible y sin comillas.
 */
function nombreSeguro(nombre: string | null): string | undefined {
  if (!nombre) return undefined;
  const limpio = nombre.replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 80);
  return limpio || undefined;
}
