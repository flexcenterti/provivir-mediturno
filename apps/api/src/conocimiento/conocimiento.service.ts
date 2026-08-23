import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EstadoArticulo, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { trocear } from './conocimiento.troceado';
import { parsearTemas, temaProhibido } from './conocimiento.temas';
import { categoriaDe, dividirDocumentacion, emparejarServicio } from './conocimiento.importacion';
import {
  decidir,
  normalizarPregunta,
  SQL_RECUPERAR,
  type FragmentoRecuperado,
  type ResultadoBusqueda,
} from './conocimiento.busqueda';
import type { ActualizarArticuloDto, CrearArticuloDto } from './dto/articulo.dto';

/** Claves en `configuracion`. Nunca constantes en código (CLAUDE.md). */
export const CLAVE_UMBRAL = 'kb_score_min';
export const CLAVE_TOP_K = 'kb_top_k';
export const CLAVE_TEMAS = 'kb_temas_prohibidos';
export const CLAVE_DOC_COMERCIAL = 'documentacion_comercial';

const UMBRAL_POR_DEFECTO = 62;
const TOP_K_POR_DEFECTO = 5;

@Injectable()
export class ConocimientoService {
  private readonly log = new Logger(ConocimientoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  // ─────────────────────────── Consulta ───────────────────────────

  listar(estado?: EstadoArticulo, servicioId?: string) {
    return this.prisma.kbArticulo.findMany({
      where: { ...(estado ? { estado } : {}), ...(servicioId ? { servicioId } : {}) },
      orderBy: [{ estado: 'asc' }, { categoria: 'asc' }, { titulo: 'asc' }],
      include: { _count: { select: { fragmentos: true } } },
    });
  }

  async porId(id: string) {
    const articulo = await this.prisma.kbArticulo.findUnique({
      where: { id },
      include: { fragmentos: { orderBy: { orden: 'asc' } } },
    });
    if (!articulo) throw new NotFoundException('Artículo no encontrado');
    return articulo;
  }

  // ─────────────────────── Ciclo de vida (RN-13.5) ───────────────────────

  async crear(dto: CrearArticuloDto, usuarioId: string, sedeId: string) {
    const articulo = await this.prisma.kbArticulo.create({
      data: { ...dto, sedeId, autorId: usuarioId, estado: 'borrador' },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Artículo creado',
      entidad: `kb_articulo/${articulo.id}`,
      detalle: articulo.titulo,
      estadoNext: 'borrador',
    });
    return articulo;
  }

  /**
   * Editar un artículo publicado reindexa en la misma transacción. Con la capa
   * léxica no hay nada que encolar: trocear e insertar es trabajo síncrono de
   * milisegundos, y el `tsvector` lo construye el trigger. La cola vuelve a hacer
   * falta cuando entre la capa semántica, que sí depende de un proveedor externo.
   */
  async actualizar(id: string, dto: ActualizarArticuloDto, usuarioId: string) {
    const previo = await this.porId(id);

    const articulo = await this.prisma.$transaction(async (tx) => {
      const actualizado = await tx.kbArticulo.update({ where: { id }, data: dto });
      if (dto.contenidoMd !== undefined && actualizado.estado === 'publicado') {
        await this.reindexar(tx, id, actualizado.contenidoMd, actualizado.titulo);
      }
      return actualizado;
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Artículo actualizado',
      entidad: `kb_articulo/${id}`,
      detalle: `Campos: ${Object.keys(dto).join(', ')}${
        dto.contenidoMd !== undefined && previo.estado === 'publicado' ? ' · reindexado' : ''
      }`,
    });
    return articulo;
  }

  /** Publicar sube la versión y reconstruye el índice del artículo. */
  async publicar(id: string, usuarioId: string) {
    const previo = await this.porId(id);
    if (previo.estado === 'publicado') {
      throw new BadRequestException('El artículo ya está publicado');
    }
    if (!previo.contenidoMd.trim()) {
      throw new BadRequestException('Un artículo sin contenido no puede publicarse');
    }

    const articulo = await this.prisma.$transaction(async (tx) => {
      const publicado = await tx.kbArticulo.update({
        where: { id },
        data: {
          estado: 'publicado',
          version: { increment: 1 },
          archivadoEn: null,
          archivadoPor: null,
          requiereRevision: false,
        },
      });
      await this.reindexar(tx, id, publicado.contenidoMd, publicado.titulo);
      return publicado;
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Artículo publicado',
      entidad: `kb_articulo/${id}`,
      detalle: `${articulo.titulo} · v${articulo.version}`,
      estadoPrev: previo.estado,
      estadoNext: 'publicado',
    });
    return articulo;
  }

  /**
   * RN-13.5 · Archivar borra los fragmentos EN LA MISMA TRANSACCIÓN: no existe un
   * instante en el que el artículo esté archivado y el bot todavía lo recupere.
   * La ficha se conserva porque la auditoría debe poder explicar respuestas ya dadas.
   */
  async archivar(id: string, usuarioId: string) {
    const previo = await this.porId(id);

    const articulo = await this.prisma.$transaction(async (tx) => {
      await tx.kbFragmento.deleteMany({ where: { articuloId: id } });
      return tx.kbArticulo.update({
        where: { id },
        data: {
          estado: 'archivado',
          archivadoEn: new Date(),
          archivadoPor: usuarioId,
          requiereRevision: false,
        },
      });
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Artículo archivado',
      entidad: `kb_articulo/${id}`,
      detalle: `${articulo.titulo} · fuera del índice desde este momento`,
      estadoPrev: previo.estado,
      estadoNext: 'archivado',
    });
    return articulo;
  }

  /** Vuelve a borrador, nunca directo a publicado: obliga a revisarlo (RN-13.5.3). */
  async reactivar(id: string, usuarioId: string) {
    const previo = await this.porId(id);
    if (previo.estado !== 'archivado') {
      throw new BadRequestException('Solo se reactivan artículos archivados');
    }

    const articulo = await this.prisma.kbArticulo.update({
      where: { id },
      data: { estado: 'borrador', archivadoEn: null, archivadoPor: null },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Artículo reactivado',
      entidad: `kb_articulo/${id}`,
      detalle: 'Vuelve a borrador para revisión antes de publicarse',
      estadoPrev: 'archivado',
      estadoNext: 'borrador',
    });
    return articulo;
  }

  /**
   * RN-13.5.4 · Solo se borran definitivamente los borradores: nunca sustentaron
   * una respuesta, así que no hay trazabilidad que romper.
   */
  async eliminar(id: string, usuarioId: string) {
    const articulo = await this.porId(id);
    if (articulo.estado !== 'borrador') {
      throw new BadRequestException(
        'Solo los borradores pueden eliminarse. Un artículo publicado o archivado sustenta respuestas ya dadas: archívalo en su lugar.',
      );
    }

    await this.prisma.kbArticulo.delete({ where: { id } });
    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Borrador eliminado',
      entidad: `kb_articulo/${id}`,
      detalle: `${articulo.titulo} · nunca publicado`,
      estadoPrev: 'borrador',
      estadoNext: 'eliminado',
    });
    return { eliminado: true };
  }

  /** RN-13.5.5 · Trabajo diario: lo que perdió vigencia sale del índice solo. */
  async archivarVencidos(): Promise<number> {
    const vencidos = await this.prisma.kbArticulo.findMany({
      where: { estado: 'publicado', vigenteHasta: { not: null, lte: new Date() } },
      select: { id: true, titulo: true },
    });

    for (const { id, titulo } of vencidos) {
      await this.prisma.$transaction(async (tx) => {
        await tx.kbFragmento.deleteMany({ where: { articuloId: id } });
        await tx.kbArticulo.update({
          where: { id },
          data: { estado: 'archivado', archivadoEn: new Date(), archivadoPor: 'sistema' },
        });
      });
      await this.auditoria.registrar({
        usuario: 'sistema',
        accion: 'Artículo archivado por vigencia',
        entidad: `kb_articulo/${id}`,
        detalle: titulo,
        estadoPrev: 'publicado',
        estadoNext: 'archivado',
      });
    }

    if (vencidos.length) this.log.log(`Archivados ${vencidos.length} artículo(s) por vigencia cumplida`);
    return vencidos.length;
  }

  /**
   * RN-04.5.4 · Al desactivar un servicio sus artículos quedan marcados. No se
   * archivan solos: puede que el texto siga siendo válido y la decisión es de
   * quien administra, pero dejarlo pasar en silencio es cómo el bot termina
   * ofreciendo algo que ya no se presta.
   */
  async marcarParaRevisionPorServicio(servicioId: string): Promise<number> {
    const { count } = await this.prisma.kbArticulo.updateMany({
      where: { servicioId, estado: 'publicado' },
      data: { requiereRevision: true },
    });
    return count;
  }

  // ─────────────────────── Importación (RN-13) ───────────────────────

  /** ¿La base ya puede sostener al bot por sí sola? */
  async hayContenidoPublicado(): Promise<boolean> {
    return (await this.prisma.kbArticulo.count({ where: { estado: 'publicado' } })) > 0;
  }

  /**
   * Convierte `configuracion.documentacion_comercial` en artículos publicados.
   *
   * Es idempotente por título: volver a correrla no duplica nada, así que se puede
   * ejecutar tras cada entrega de contenido del cliente sin pensarlo dos veces.
   *
   * NO borra el parámetro. El prompt deja de inyectarlo solo cuando hay artículos
   * publicados (RN-13), y conservarlo permite volver atrás archivando los artículos
   * si algo sale mal.
   */
  async importarDocumentacionComercial(
    usuarioId: string,
    sedeId: string,
  ): Promise<{
    creados: Array<{ titulo: string; servicioId: string | null }>;
    omitidos: string[];
    sinServicio: string[];
  }> {
    const texto = this.configuracion.texto(CLAVE_DOC_COMERCIAL, '');
    if (!texto.trim()) return { creados: [], omitidos: [], sinServicio: [] };

    const servicios = await this.prisma.servicio.findMany({
      where: { activo: true },
      select: { id: true, nombre: true },
    });

    const creados: Array<{ titulo: string; servicioId: string | null }> = [];
    const omitidos: string[] = [];
    const sinServicio: string[] = [];

    for (const bloque of dividirDocumentacion(texto)) {
      const yaExiste = await this.prisma.kbArticulo.findFirst({
        where: { titulo: bloque.titulo },
        select: { id: true },
      });
      if (yaExiste) {
        omitidos.push(bloque.titulo);
        continue;
      }

      const servicioId = emparejarServicio(bloque.titulo, servicios);
      if (!servicioId) sinServicio.push(bloque.titulo);

      const articulo = await this.crear(
        {
          titulo: bloque.titulo,
          categoria: categoriaDe(bloque.titulo, servicioId),
          contenidoMd: `## ${bloque.titulo}\n\n${bloque.cuerpo}`,
          ...(servicioId ? { servicioId } : {}),
        },
        usuarioId,
        sedeId,
      );
      // Es contenido que el cliente ya aprobó y que el bot ya está usando desde el
      // prompt: publicarlo no expone nada nuevo, solo cambia por dónde lo recupera.
      await this.publicar(articulo.id, usuarioId);
      creados.push({ titulo: bloque.titulo, servicioId });
    }

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Documentación comercial importada',
      entidad: 'kb_articulo',
      detalle: `${creados.length} artículo(s) creados · ${omitidos.length} ya existían · ${sinServicio.length} sin servicio vinculado`,
    });

    return { creados, omitidos, sinServicio };
  }

  // ─────────────────────────── Recuperación ───────────────────────────

  private umbral(): number {
    return this.configuracion.numero(CLAVE_UMBRAL, UMBRAL_POR_DEFECTO);
  }

  /**
   * Punto único de entrada para el bot y para el probador del backoffice.
   * `registrar` en false permite ensayar preguntas sin contaminar las métricas
   * ni la cola de preguntas sin respuesta.
   */
  async buscar(
    pregunta: string,
    opciones: { servicioId?: string; conversacionId?: string; registrar?: boolean } = {},
  ): Promise<ResultadoBusqueda> {
    const { servicioId, conversacionId, registrar = true } = opciones;

    // El tema prohibido se evalúa ANTES de buscar: que exista un artículo que lo
    // cubra no es motivo para responder (RN-13.4).
    const tema = temaProhibido(pregunta, parsearTemas(this.configuracion.texto(CLAVE_TEMAS, '')));

    const fragmentos = tema
      ? []
      : await this.prisma.$queryRawUnsafe<FragmentoRecuperado[]>(
          SQL_RECUPERAR,
          pregunta,
          servicioId ?? null,
          this.configuracion.numero(CLAVE_TOP_K, TOP_K_POR_DEFECTO),
        );

    const resultado = decidir(fragmentos, this.umbral(), tema);
    if (registrar) await this.registrarConsulta(pregunta, resultado, conversacionId);
    return resultado;
  }

  private async registrarConsulta(
    pregunta: string,
    resultado: ResultadoBusqueda,
    conversacionId?: string,
  ): Promise<void> {
    try {
      await this.prisma.kbConsulta.create({
        data: {
          conversacionId: conversacionId ?? null,
          pregunta,
          scoreTop: resultado.tipo === 'bloqueada' ? null : resultado.mejorPuntaje,
          articulos:
            resultado.tipo === 'bloqueada' ? [] : [...new Set(resultado.fragmentos.map((f) => f.articuloId))],
          resultado:
            resultado.tipo === 'bloqueada'
              ? 'bloqueada_por_tema'
              : resultado.tipo === 'respondida'
                ? 'respondida'
                : 'escalada',
          temaBloqueado: resultado.tipo === 'bloqueada' ? resultado.tema : null,
        },
      });

      // Los temas prohibidos NO alimentan la cola de mejora: no se resuelven
      // escribiendo un artículo, se resuelven con una persona.
      if (resultado.tipo === 'sin_cobertura') {
        await this.registrarSinCobertura(pregunta, conversacionId);
      }
    } catch (e) {
      // Igual que la auditoría: perder una línea de telemetría no puede tumbar
      // la respuesta al paciente.
      this.log.error('No se pudo registrar la consulta a la base de conocimiento', e as Error);
    }
  }

  /** RN-13.6 · Agrupa por pregunta normalizada y suma ocurrencias. */
  private async registrarSinCobertura(pregunta: string, conversacionId?: string): Promise<void> {
    const normalizada = normalizarPregunta(pregunta);
    if (!normalizada) return;

    await this.prisma.kbPendiente.upsert({
      where: { preguntaNormalizada: normalizada },
      update: { ocurrencias: { increment: 1 }, estado: 'abierta' },
      create: {
        preguntaNormalizada: normalizada,
        preguntaEjemplo: pregunta.trim(),
        ejemploConversacionId: conversacionId ?? null,
      },
    });
  }

  // ─────────────────── Cola de preguntas sin respuesta ───────────────────

  pendientes(soloAbiertas = true) {
    return this.prisma.kbPendiente.findMany({
      where: soloAbiertas ? { estado: 'abierta' } : {},
      orderBy: [{ ocurrencias: 'desc' }, { actualizadoEn: 'desc' }],
      take: 100,
    });
  }

  /** Convierte una pregunta sin respuesta en un borrador, listo para redactar. */
  async crearDesdePendiente(pendienteId: string, usuarioId: string, sedeId: string) {
    const pendiente = await this.prisma.kbPendiente.findUnique({ where: { id: pendienteId } });
    if (!pendiente) throw new NotFoundException('Pregunta no encontrada');
    if (pendiente.estado !== 'abierta') throw new BadRequestException('Esa pregunta ya fue gestionada');

    const articulo = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.kbArticulo.create({
        data: {
          titulo: pendiente.preguntaEjemplo.replace(/[¿?]/g, '').trim().slice(0, 120),
          categoria: 'Preguntas frecuentes',
          contenidoMd: `## ${pendiente.preguntaEjemplo.trim()}\n\n_Pendiente de redactar._\n`,
          estado: 'borrador',
          sedeId,
          autorId: usuarioId,
        },
      });
      await tx.kbPendiente.update({ where: { id: pendienteId }, data: { estado: 'articulo_creado' } });
      return creado;
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Artículo creado desde pregunta sin respuesta',
      entidad: `kb_articulo/${articulo.id}`,
      detalle: `${pendiente.ocurrencias} paciente(s) preguntaron lo mismo`,
      estadoPrev: 'sin cobertura',
      estadoNext: 'borrador',
    });
    return articulo;
  }

  async descartarPendiente(pendienteId: string, usuarioId: string) {
    const pendiente = await this.prisma.kbPendiente.update({
      where: { id: pendienteId },
      data: { estado: 'descartada' },
    });
    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Pregunta sin respuesta descartada',
      entidad: `kb_pendiente/${pendienteId}`,
      detalle: pendiente.preguntaEjemplo,
    });
    return pendiente;
  }

  // ─────────────────────────── Interno ───────────────────────────

  /**
   * Reconstruye los fragmentos de un artículo. El `tsvector` lo pone el trigger.
   *
   * Cada fragmento lleva el título del artículo cuando no arranca con un encabezado
   * propio. Sirve dos veces: el título aporta el tema al índice —un fragmento suelto
   * de una sección larga pierde de qué habla— y le da contexto al modelo, que recibe
   * el texto sin saber de dónde salió.
   */
  private async reindexar(
    tx: Prisma.TransactionClient,
    articuloId: string,
    contenido: string,
    titulo: string,
  ): Promise<void> {
    await tx.kbFragmento.deleteMany({ where: { articuloId } });
    const fragmentos = trocear(contenido);
    if (!fragmentos.length) return;

    await tx.kbFragmento.createMany({
      data: fragmentos.map((f) => {
        const texto = f.texto.startsWith('#') ? f.texto : `## ${titulo}\n${f.texto}`;
        return { articuloId, orden: f.orden, texto, tokens: f.tokens };
      }),
    });
  }
}
