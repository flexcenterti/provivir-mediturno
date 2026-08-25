import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { ConocimientoService } from './conocimiento.service';
import { categoriaDe, dividirDocumentacion, emparejarServicio } from './conocimiento.importacion';
import type { DatosImportacionKb, ErrorImportacion, ResumenImportacionKb } from './conocimiento.importacion.tipos';

/** Lo que se acepta hoy. `.docx` exigiría un parser nuevo, que es dependencia nueva. */
export const EXTENSIONES_KB = ['.md', '.txt'];

@Injectable()
export class ImportacionProcesador {
  private readonly log = new Logger(ImportacionProcesador.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conocimiento: ConocimientoService,
  ) {}

  /**
   * Punto de extensión único para formatos nuevos. Cuando se apruebe `mammoth`,
   * `.docx` es un `case` aquí y una entrada en `EXTENSIONES_KB`: nada más cambia.
   */
  private async extraerTexto(ruta: string): Promise<string> {
    const ext = extname(ruta).toLowerCase();
    switch (ext) {
      case '.md':
      case '.txt':
        return readFile(ruta, 'utf8');
      default:
        throw new Error(`Formato no soportado: ${ext}`);
    }
  }

  /**
   * Trocea el documento por encabezados y crea un artículo por bloque.
   *
   * **Todo entra como borrador.** Es la diferencia deliberada con
   * `importarDocumentacionComercial`, que sí publica: aquella migra un texto que
   * el bot ya venía usando desde el prompt, así que publicarlo no expone nada
   * nuevo. Un documento que alguien acaba de subir no lo ha revisado nadie, y
   * RN-13.7.1 dice que al bot no se le sirve lo que no está aprobado.
   */
  async procesar(
    datos: DatosImportacionKb,
    avance: (progreso: { procesados: number; total: number }) => Promise<void>,
  ): Promise<ResumenImportacionKb> {
    const texto = await this.extraerTexto(datos.rutaArchivo);
    const bloques = dividirDocumentacion(texto);

    const servicios = await this.prisma.servicio.findMany({
      where: { activo: true },
      select: { id: true, nombre: true },
    });

    const resumen: ResumenImportacionKb = {
      totalBloques: bloques.length,
      creados: 0,
      omitidos: 0,
      sinServicio: [],
      erroneos: 0,
      errores: [],
    };

    for (const [i, bloque] of bloques.entries()) {
      try {
        const yaExiste = await this.prisma.kbArticulo.findFirst({
          where: { titulo: bloque.titulo },
          select: { id: true },
        });
        if (yaExiste) {
          resumen.omitidos++;
          continue;
        }

        const servicioId = emparejarServicio(bloque.titulo, servicios);
        if (!servicioId) resumen.sinServicio.push(bloque.titulo);

        await this.conocimiento.crear(
          {
            titulo: bloque.titulo,
            categoria: categoriaDe(bloque.titulo, servicioId),
            // El encabezado se conserva en el markdown: el troceo lo usa para dar
            // contexto a cada fragmento cuando el artículo se parta en varios.
            contenidoMd: `## ${bloque.titulo}\n\n${bloque.cuerpo}`,
            ...(servicioId ? { servicioId } : {}),
          },
          datos.usuarioId,
          datos.sedeId,
        );
        resumen.creados++;
      } catch (e) {
        const motivo = e instanceof Error ? e.message : 'Error desconocido';
        const error: ErrorImportacion = { bloque: i + 1, titulo: bloque.titulo, motivo };
        resumen.errores.push(error);
        resumen.erroneos++;
        this.log.warn(`Bloque ${i + 1} («${bloque.titulo}») falló: ${motivo}`);
      }

      await avance({ procesados: i + 1, total: bloques.length });
    }

    return resumen;
  }
}
