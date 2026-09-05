import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BYTES_DE_FIRMA, extensionCanonica, SEDE_ID, tipoDeImagen,
} from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { directorioDeAnuncios, rutaDeAnuncio } from './anuncios.almacen';

/**
 * RN-11.7 · La publicidad de las salas de espera.
 *
 * Cuatro y no más: cinco carteles lado a lado en un televisor visto desde tres metros
 * no se leen. El tope se aplica **en los dos extremos y son garantías distintas**: al
 * escribir es un 409 con una carrera real —dos administradores subiendo a la vez pasan
 * los dos el conteo—, y al leer es un `take` que no tiene carrera ninguna. Si por la vía
 * que sea acaban existiendo diez, el televisor muestra cuatro.
 */
export const MAX_ANUNCIOS = 4;

/** 2 MB sobra para un banner de 1200×480. Los pesados alargan la primera carga del TV. */
export const MAX_BYTES_ANUNCIO = 2 * 1024 * 1024;

export const EXTENSIONES_ANUNCIO = ['.png', '.jpg', '.jpeg', '.webp'];

/** Se vuelve a filtrar a la salida: una fila corrupta no puede producir `text/html`. */
const MIMES_SERVIBLES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp'];

@Injectable()
export class AnunciosService {
  private readonly log = new Logger(AnunciosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly config: ConfigService,
  ) {}

  private get dirMedia(): string {
    return this.config.get<string>('DIR_MEDIA') || 'media';
  }

  listar() {
    return this.prisma.anuncioSala.findMany({
      where: { sedeId: SEDE_ID },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
      // `take` aunque haya un tope al escribir: es la única garantía sin carreras.
      take: MAX_ANUNCIOS,
      select: { id: true, nombreOriginal: true, mime: true, bytes: true, orden: true },
    });
  }

  /**
   * Guarda una imagen recién subida.
   *
   * Llega **en memoria**, así que nada toca el volumen hasta que la firma dice que es
   * una imagen de verdad. La extensión con la que se guarda sale del contenido, no del
   * nombre que mandó el navegador: así un `.jpeg` y un `.jpg` acaban igual, y un `.png`
   * que por dentro es un JPEG se guarda —y se sirve— como lo que realmente es.
   */
  async crear(archivo: Express.Multer.File, usuarioId: string) {
    const mime = tipoDeImagen(archivo.buffer.subarray(0, BYTES_DE_FIRMA));
    if (!mime) {
      throw new BadRequestException(
        'El archivo no es una imagen PNG, JPG o WebP. Cambiarle la extensión no lo convierte en una.',
      );
    }

    const cuantos = await this.prisma.anuncioSala.count({ where: { sedeId: SEDE_ID } });
    if (cuantos >= MAX_ANUNCIOS) {
      throw new ConflictException(
        `Ya hay ${MAX_ANUNCIOS} anuncios. Retira uno antes de subir otro: la franja del `
        + 'televisor solo muestra cuatro, y a partir de ahí no se leen desde la sala.',
      );
    }

    const nombre = `${randomUUID()}${extensionCanonica(mime)}`;
    const directorio = directorioDeAnuncios(this.dirMedia);
    // En arranque no: el volumen nombrado tapa lo que la imagen traiga en ese punto de
    // montaje, así que la carpeta se crea la primera vez que hace falta.
    await mkdir(directorio, { recursive: true });
    await writeFile(join(directorio, nombre), archivo.buffer);

    const anuncio = await this.prisma.anuncioSala.create({
      data: {
        archivo: nombre,
        mime,
        bytes: archivo.size,
        nombreOriginal: nombreSeguro(archivo.originalname) ?? nombre,
        orden: cuantos,
        sedeId: SEDE_ID,
      },
      select: { id: true, nombreOriginal: true, mime: true, bytes: true, orden: true },
    });

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Anuncio de sala subido',
      entidad: `anuncio/${anuncio.id}`,
      detalle: `${anuncio.nombreOriginal} · ${mime} · ${archivo.size} bytes`,
    });
    return anuncio;
  }

  /**
   * Retirar borra la fila **y el archivo**. Igual que con las pantallas (RN-11.6), un
   * borrado lógico dejaría el archivo en disco y una ruta pública sirviéndolo, salvo
   * que dos caminos de lectura se acordaran del filtro.
   *
   * Primero la fila y después el archivo, a propósito: al revés, si el DELETE fallara
   * quedaría una fila apuntando a nada y el televisor pintaría un hueco. En este orden
   * lo peor que queda son bytes que **nadie puede alcanzar** — sin fila no hay id, y sin
   * id no hay URL.
   */
  async eliminar(id: string, usuarioId: string) {
    const anuncio = await this.prisma.anuncioSala.findUnique({ where: { id } });
    if (!anuncio) throw new NotFoundException('Anuncio no encontrado');

    await this.prisma.anuncioSala.delete({ where: { id } });

    const ruta = rutaDeAnuncio(this.dirMedia, anuncio.archivo);
    // Un `unlink` fallido no puede abortar la operación: un archivo borrado a mano
    // dejaría el anuncio imposible de retirar desde el producto.
    if (ruta) await unlink(ruta).catch(() => this.log.warn(`No se pudo borrar ${anuncio.archivo}`));

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Anuncio de sala retirado',
      entidad: `anuncio/${id}`,
      detalle: anuncio.nombreOriginal,
    });
  }

  /** Intercambia un anuncio con su vecino en la franja. */
  async mover(id: string, direccion: 'izquierda' | 'derecha', usuarioId: string) {
    const todos = await this.prisma.anuncioSala.findMany({
      where: { sedeId: SEDE_ID },
      orderBy: [{ orden: 'asc' }, { creadoEn: 'asc' }],
      select: { id: true },
    });
    const i = todos.findIndex((a) => a.id === id);
    if (i === -1) throw new NotFoundException('Anuncio no encontrado');

    const j = direccion === 'izquierda' ? i - 1 : i + 1;
    if (j < 0 || j >= todos.length) return this.listar();

    /*
     * Se reescribe el orden de TODOS y no solo el de los dos que se cruzan: los valores
     * heredados pueden estar repetidos o con huecos —nada garantiza que sean 0,1,2,3— y
     * entonces intercambiar dos valores iguales no movería nada.
     *
     * En una transacción: a mitad de camino la franja quedaría en un orden que no pidió
     * nadie.
     */
    const reordenados = [...todos];
    [reordenados[i], reordenados[j]] = [reordenados[j]!, reordenados[i]!];
    await this.prisma.$transaction(
      reordenados.map((a, orden) =>
        this.prisma.anuncioSala.update({ where: { id: a.id }, data: { orden } }),
      ),
    );

    await this.auditoria.registrar({
      usuario: usuarioId,
      accion: 'Anuncios de sala reordenados',
      entidad: `anuncio/${id}`,
      detalle: direccion,
    });
    return this.listar();
  }

  /**
   * Dónde está la imagen y con qué tipo se sirve.
   *
   * El id nunca se convierte en ruta: se busca la fila, y el nombre que ella guarda pasa
   * por `rutaDeAnuncio`, que valida el patrón y que lo resuelto caiga dentro.
   */
  async imagen(id: string) {
    const anuncio = await this.prisma.anuncioSala.findUnique({ where: { id } });
    if (!anuncio) throw new NotFoundException('Anuncio no encontrado');

    const ruta = rutaDeAnuncio(this.dirMedia, anuncio.archivo);
    if (!ruta) {
      this.log.error(`Anuncio con nombre de archivo inválido: ${id}`);
      throw new NotFoundException('Anuncio no disponible');
    }
    if (!existsSync(ruta)) {
      // Consta en la base y no está en disco: es un incidente operativo, no un 404 más.
      this.log.warn(`Anuncio ausente en disco: ${id} · ${anuncio.archivo}`);
      throw new NotFoundException('Anuncio no disponible');
    }
    if (!MIMES_SERVIBLES.includes(anuncio.mime)) {
      this.log.error(`Anuncio con mime no servible: ${id} · ${anuncio.mime}`);
      throw new NotFoundException('Anuncio no disponible');
    }

    return { ruta, contentType: anuncio.mime, bytes: anuncio.bytes };
  }
}

/**
 * El nombre lo escribe quien sube el archivo y se pinta en el backoffice. Se queda solo
 * lo imprimible, como en los adjuntos de WhatsApp.
 */
function nombreSeguro(nombre: string | undefined): string | undefined {
  if (!nombre) return undefined;
  const limpio = nombre.replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 80);
  return limpio || undefined;
}
