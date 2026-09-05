import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage, memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

/**
 * Opciones de subida de archivos, en un solo sitio.
 *
 * El bloque estaba copiado dos veces en `carga.controller.ts` y la importación de
 * documentos a la base de conocimiento sería la tercera. Que el endurecimiento
 * —nombre generado, tope de tamaño, lista blanca de extensiones— dependa de
 * acordarse de copiarlo bien es justo lo que no queremos.
 */

/** Fuera del webroot: lo subido nunca se sirve como estático. */
export const DIR_SUBIDAS = process.env.DIR_SUBIDAS ?? 'uploads';

/**
 * @param extensiones lista blanca en minúscula y con punto (`['.csv', '.txt']`).
 * @param maxBytes tope de tamaño; se dimensiona por caso de uso, no hay uno global.
 */
export function opcionesSubida(extensiones: string[], maxBytes: number): MulterOptions {
  return {
    // Nombre generado: nada del nombre original que mandó el navegador toca el disco.
    storage: diskStorage({
      destination: DIR_SUBIDAS,
      filename: (_req, file, cb) =>
        cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!extensiones.includes(ext)) {
        return cb(
          new BadRequestException(`Extensión no permitida. Use: ${extensiones.join(', ')}`),
          false,
        );
      }
      cb(null, true);
    },
  };
}

/**
 * Para lo pequeño que hay que **inspeccionar antes de guardarlo**.
 *
 * `opcionesSubida` escribe a disco, y eso es lo correcto para un CSV de 200 MB que se
 * procesa por lotes. Para una imagen que hay que validar por su contenido es lo
 * contrario, por una razón que no es obvia: cuando salta `limits.fileSize`, **multer
 * deja el archivo parcial en disco** y la excepción la lanza el interceptor, así que el
 * manejador nunca llega a correr y no puede limpiarlo. En memoria no hay nada que
 * limpiar, y el archivo no llega al volumen hasta que se sabe que es lo que dice ser.
 *
 * Solo para topes pequeños: el buffer entero vive en memoria.
 */
export function opcionesSubidaEnMemoria(extensiones: string[], maxBytes: number): MulterOptions {
  return {
    storage: memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!extensiones.includes(ext)) {
        return cb(
          new BadRequestException(`Extensión no permitida. Use: ${extensiones.join(', ')}`),
          false,
        );
      }
      cb(null, true);
    },
  };
}
