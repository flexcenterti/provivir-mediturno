import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
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
