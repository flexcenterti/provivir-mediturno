/** Encabezados aceptados de la exportación del cliente (Especificación §2.2). */
export const COLUMNAS = {
  nombres: ['nombres', 'nombre', 'primer nombre', 'nombres paciente'],
  apellidos: ['apellidos', 'apellido', 'primer apellido', 'apellidos paciente'],
  documento: ['documento', 'identificacion', 'identificación', 'numero de identificacion',
    'número de identificación', 'cedula', 'cédula', 'nro documento', 'no. documento'],
  telefono: ['telefono', 'teléfono', 'celular', 'numero de contacto', 'número de contacto',
    'contacto', 'movil', 'móvil'],
  correo: ['correo', 'email', 'e-mail', 'correo electronico', 'correo electrónico'],
  tdoc: ['tipo documento', 'tipo de documento', 'tdoc'],
  servicio: ['servicio', 'ultimo servicio', 'último servicio', 'servicios', 'servicio tomado'],
  fechaServicio: ['fecha servicio', 'fecha del servicio', 'fecha ultimo servicio',
    'fecha último servicio', 'fecha atencion', 'fecha atención', 'fecha'],
} as const;

export type CampoCarga = keyof typeof COLUMNAS;

export interface FilaNormalizada {
  documento: string;
  nombres: string;
  apellidos: string;
  telefono?: string;
  correo?: string;
  tdoc: string;
  servicio?: string;
  fechaServicio?: Date;
}

export interface ErrorCarga {
  fila: number;
  motivo: string;
  /** Documento enmascarado: el reporte de errores no expone PII en claro. */
  documento: string;
}

export interface ResumenCarga {
  totalFilas: number;
  creados: number;
  actualizados: number;
  duplicadosRechazados: number;
  fueraDeFiltro: number;
  erroneos: number;
  historialesCreados: number;
  errores: ErrorCarga[];
}

export interface DatosTrabajoCarga {
  rutaArchivo: string;
  nombreOriginal: string;
  usuarioId: string;
  /** RN-12.3 · solo pacientes con al menos un servicio en el último año. */
  filtrarUltimoAnio: boolean;
}
