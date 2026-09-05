import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { existsSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { finDelDiaEnZona, inicioDelDiaEnZona } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { TurnosGateway } from '../turnos/turnos.gateway';
import { ConversacionService } from '../whatsapp/conversacion.service';
import { FueraDeVentanaMeta, MetaCliente } from '../whatsapp/meta.cliente';
import { VentanaService } from '../whatsapp/ventana.service';
import { mimeDeExtension } from '../whatsapp/media.tipos';
import { parametrosReapertura } from '../whatsapp/whatsapp.plantillas';
import { variantesDeTelefono } from '../whatsapp/whatsapp.normalizador';
import { armarPagina } from '../comun/paginacion';
import { esperaEnMinutos, ordenarPendientes } from './bandeja.orden';
import { PENDIENTES } from './bandeja.filtros';
import type { BuscarBandejaDto } from './dto/bandeja.dto';

/** Nombre de la plantilla aprobada en Meta para retomar una conversación cerrada. */
const CLAVE_PLANTILLA_REAPERTURA = 'plantilla_reapertura_conversacion';

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

    const plantilla = this.nombrePlantillaReapertura();
    if (!plantilla) {
      // Sin plantilla no se intenta: Meta lo rechazaría y reintentar no cambia nada.
      await this.auditoria.registrar({
        usuario: usuarioId,
        accion: 'Plantilla de reapertura no enviada',
        entidad: `conversacion/${id}`,
        detalle: `Sin nombre en la configuración ${CLAVE_PLANTILLA_REAPERTURA}`,
      });
      throw new ConflictException(
        'No hay plantilla de reapertura configurada. Se define en Administración → Reglas con el nombre aprobado en Meta.',
      );
    }

    // Una plantilla al día por conversación: si el paciente no contesta a la
    // primera, insistir con la misma no lo cambia y a Meta le consta como spam.
    const yaEnviada = await this.prisma.mensaje.findFirst({
      where: {
        conversacionId: id,
        direccion: 'saliente',
        tipo: 'plantilla',
        ts: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
      },
      select: { id: true },
    });
    if (yaEnviada) {
      throw new ConflictException('Ya se le envió una plantilla en las últimas 24 h');
    }

    const waMessageId = await this.meta.enviarPlantilla(
      conversacion.telefono,
      plantilla,
      parametrosReapertura(conversacion.paciente?.nombres ?? null),
    );

    await this.prisma.$transaction([
      this.prisma.mensaje.create({
        data: {
          conversacionId: id,
          direccion: 'saliente',
          tipo: 'plantilla',
          contenido: `Plantilla «${plantilla}»`,
          waMessageId: waMessageId || null,
          autorId: usuarioId,
        },
      }),
      // Quien manda la plantilla, atiende: es quien espera la respuesta.
      this.prisma.conversacion.update({
        where: { id },
        data: { tomadaPor: usuarioId, estado: 'en_gestion' },
      }),
    ]);

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Plantilla de reapertura enviada',
      entidad: `conversacion/${id}`,
      detalle: `Plantilla ${plantilla}`,
    });

    this.gateway.emitirPendientesBandeja(await this.conteoPendientes());
    return { enviado: true, plantilla };
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
