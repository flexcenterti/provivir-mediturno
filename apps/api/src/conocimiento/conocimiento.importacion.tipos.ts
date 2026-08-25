/** Importación de un documento del cliente a artículos de la base (RN-13). */

export interface DatosImportacionKb {
  rutaArchivo: string;
  nombreOriginal: string;
  usuarioId: string;
  sedeId: string;
}

export interface ErrorImportacion {
  /** Posición del bloque dentro del documento, 1-based: es lo que el humano cuenta. */
  bloque: number;
  titulo: string;
  motivo: string;
}

export interface ResumenImportacionKb {
  totalBloques: number;
  creados: number;
  /** Ya existía un artículo con ese título: la importación es idempotente. */
  omitidos: number;
  /** Títulos que no se pudieron atar a un servicio y conviene revisar a mano. */
  sinServicio: string[];
  erroneos: number;
  errores: ErrorImportacion[];
}
