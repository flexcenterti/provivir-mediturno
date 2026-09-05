export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'asistente' | 'prestador' | 'pantalla';
  prestadorId: string | null;
  /** Permisos efectivos del perfil. El menú se arma con esto, no con el rol. */
  permisos: string[];
}

export interface DefinicionPermiso {
  clave: string; area: string; etiqueta: string; descripcion: string;
}

export interface Perfil {
  id: string;
  nombre: string;
  descripcion: string | null;
  permisos: string[];
  sistema: boolean;
  activo: boolean;
  _count: { usuarios: number };
}

export interface UsuarioAdmin {
  id: string;
  email: string;
  nombre: string;
  rol: 'admin' | 'asistente' | 'prestador' | 'pantalla';
  activo: boolean;
  ultimoAcceso: string | null;
  prestadorId: string | null;
  perfil: { id: string; nombre: string; activo: boolean } | null;
}

/** La contraseña llega UNA vez, al crear o reiniciar. No se puede volver a pedir. */
export interface ClaveEmitida {
  email: string;
  password: string;
}

export interface RespuestaLogin {
  accessToken: string;
  refreshToken: string;
  usuario: UsuarioSesion;
}

const CLAVE_TOKEN = 'accessToken';
const CLAVE_REFRESCO = 'refreshToken';

/**
 * La sesión vive en `sessionStorage` a propósito: al cerrar el navegador se vuelve
 * a pedir contraseña, que es lo que se decidió para los equipos compartidos del
 * mostrador. Mientras la pestaña siga abierta y en uso, se renueva sola.
 */
export const token = {
  leer: () => sessionStorage.getItem(CLAVE_TOKEN),
  guardar: (acceso: string, refresco: string) => {
    sessionStorage.setItem(CLAVE_TOKEN, acceso);
    sessionStorage.setItem(CLAVE_REFRESCO, refresco);
  },
  borrar: () => {
    sessionStorage.removeItem(CLAVE_TOKEN);
    sessionStorage.removeItem(CLAVE_REFRESCO);
  },
};

/**
 * Un solo refresco en vuelo. Una pantalla con varios paneles lanza varias
 * peticiones a la vez: sin este cerrojo, todas verían el 401 y pedirían un token
 * nuevo, y las últimas guardarían un refresco que las primeras ya invalidaron.
 */
let refrescoEnVuelo: Promise<boolean> | null = null;

export function refrescarSesion(): Promise<boolean> {
  const refresco = sessionStorage.getItem(CLAVE_REFRESCO);
  if (!refresco) return Promise.resolve(false);

  refrescoEnVuelo ??= (async () => {
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refresco }),
      });
      if (!r.ok) return false;
      const datos = (await r.json()) as RespuestaLogin;
      token.guardar(datos.accessToken, datos.refreshToken);
      return true;
    } catch {
      // Sin red no es una sesión caída: se trata como fallo y quien llamó decide.
      return false;
    } finally {
      refrescoEnVuelo = null;
    }
  })();

  return refrescoEnVuelo;
}

/** Se avisa a la aplicación para volver al login sin dejar la vista a medias. */
let alCaerSesion: (() => void) | null = null;
export const sesion = {
  alCaer: (fn: () => void) => { alCaerSesion = fn; },
};

async function pedir<T>(ruta: string, init?: RequestInit, reintentar = true): Promise<T> {
  const t = token.leer();
  const r = await fetch(`/api${ruta}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...init?.headers,
    },
  });

  /*
   * Un 401 al INICIAR SESIÓN no es una sesión vencida: es una credencial mala. Cae
   * al manejo genérico de abajo para que llegue el motivo real que manda la API
   * —«Credenciales inválidas»—. Decirle «Sesión expirada» a quien está escribiendo
   * su contraseña hace pensar en una cuenta bloqueada, y no existe tal cosa: se
   * pierde el rato buscando un bloqueo que nadie puede levantar porque no hay.
   */
  if (r.status === 401 && ruta !== '/auth/login') {
    // El 401 normal es "el token de acceso venció": se renueva y se repite la
    // petición, sin que quien esté trabajando se entere. Solo se cae al login si
    // el refresco tampoco sirve — 8 h sin usar la plataforma, o usuario desactivado.
    // Las rutas de `auth` quedan fuera del reintento: no hay refresco que valga.
    if (reintentar && !ruta.startsWith('/auth/') && (await refrescarSesion())) {
      return pedir<T>(ruta, init, false);
    }
    token.borrar();
    alCaerSesion?.();
    throw new Error('Sesión expirada');
  }
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    throw new Error(cuerpo.message ?? 'Error en la operación');
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

/**
 * Hermana de `pedir()` para lo que no es JSON. Comparte el 401 con refresco de sesión
 * —si no, abrir un adjunto tras un rato inactivo echaría al login— y devuelve el
 * contenido como Blob, porque un `<img src>` no puede llevar la cabecera del token.
 */
async function pedirBlob(ruta: string, reintentar = true): Promise<Blob> {
  const t = token.leer();
  const r = await fetch(`/api${ruta}`, {
    headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  });

  if (r.status === 401) {
    if (reintentar && (await refrescarSesion())) return pedirBlob(ruta, false);
    token.borrar();
    alCaerSesion?.();
    throw new Error('Sesión expirada');
  }
  if (!r.ok) throw new Error('No se pudo cargar el adjunto');
  return r.blob();
}

export const api = {
  login: (email: string, password: string) =>
    pedir<RespuestaLogin>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  yo: () => pedir<UsuarioSesion>('/auth/yo'),

  resumen: (desde: string, hasta: string) => pedir<Resumen>(`/metricas/resumen?desde=${desde}&hasta=${hasta}`),
  reporte: (desde: string, hasta: string) => pedir<Reporte>(`/metricas/reporte?desde=${desde}&hasta=${hasta}`),
  balanceo: (fecha: string) => pedir<CargaMedico[]>(`/metricas/balanceo?fecha=${fecha}`),

  consolidada: (desde: string, hasta: string, prestadorId?: string) =>
    pedir<Cita[]>(`/citas/consolidada?desde=${desde}&hasta=${hasta}${prestadorId ? `&prestadorId=${prestadorId}` : ''}`),
  buscarCitas: (q: string, rango?: { desde: string; hasta: string }) =>
    pedir<Cita[]>(
      `/citas/buscar?q=${encodeURIComponent(q)}` +
        (rango ? `&desde=${rango.desde}&hasta=${rango.hasta}` : ''),
    ),
  cupos: (p: Record<string, string>) => pedir<Cupo[]>(`/cupos?${new URLSearchParams(p)}`),
  crearCita: (cuerpo: unknown) => pedir<{ creada: boolean; cita?: Cita; alternativas?: Cupo[]; motivo?: string }>(
    '/citas', { method: 'POST', body: JSON.stringify(cuerpo) }),
  cita: (id: string) => pedir<Cita>(`/citas/${id}`),
  /** Cambia fecha, hora y prestador. El motor revalida todas las reglas. */
  reprogramarCita: (
    id: string,
    cuerpo: { fecha: string; hora: string; prestadorId?: string; motivo?: string; notificar?: boolean },
  ) => pedir<Cita>(`/citas/${id}/reprogramar`, { method: 'PATCH', body: JSON.stringify(cuerpo) }),
  /** No borra: da de baja. El historial y la auditoría dependen de que la fila siga ahí. */
  cancelarCita: (id: string, cuerpo: { motivo: string; notificar?: boolean }) =>
    pedir<Cita>(`/citas/${id}/cancelar`, { method: 'PATCH', body: JSON.stringify(cuerpo) }),

  /**
   * `todos` incluye los desactivados. Hace falta en Administración: un usuario atado
   * a una ficha ya desactivada no encontraría su opción en el desplegable y perdería
   * el vínculo al guardar.
   */
  prestadores: (todos = false) => pedir<Prestador[]>(`/prestadores${todos ? '?todos=true' : ''}`),
  servicios: (todos = false) => pedir<Servicio[]>(`/servicios${todos ? '?todos=true' : ''}`),
  impactoServicio: (id: string) => pedir<ImpactoBaja>(`/servicios/${id}/impacto`),
  desactivarServicio: (id: string) =>
    pedir<Omit<ImpactoBaja, 'citas'>>(`/servicios/${id}/desactivar`, { method: 'POST' }),
  activarServicio: (id: string) => pedir<Servicio>(`/servicios/${id}/activar`, { method: 'POST' }),
  eliminarServicio: (id: string) => pedir<{ eliminado: true }>(`/servicios/${id}`, { method: 'DELETE' }),

  // ── Base de conocimiento (RN-13) ──
  resumenConocimiento: (dias = 30) =>
    pedir<ResumenConocimiento>(`/conocimiento/resumen?dias=${dias}`),
  articulos: (estado?: string) =>
    pedir<Articulo[]>(`/conocimiento/articulos${estado ? `?estado=${estado}` : ''}`),
  articulo: (id: string) => pedir<ArticuloDetalle>(`/conocimiento/articulos/${id}`),
  crearArticulo: (cuerpo: object) =>
    pedir<Articulo>('/conocimiento/articulos', { method: 'POST', body: JSON.stringify(cuerpo) }),
  actualizarArticulo: (id: string, cuerpo: object) =>
    pedir<Articulo>(`/conocimiento/articulos/${id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) }),
  publicarArticulo: (id: string) =>
    pedir<Articulo>(`/conocimiento/articulos/${id}/publicar`, { method: 'POST' }),
  archivarArticulo: (id: string) =>
    pedir<Articulo>(`/conocimiento/articulos/${id}/archivar`, { method: 'POST' }),
  reactivarArticulo: (id: string) =>
    pedir<Articulo>(`/conocimiento/articulos/${id}/reactivar`, { method: 'POST' }),
  eliminarArticulo: (id: string) =>
    pedir<{ eliminado: boolean }>(`/conocimiento/articulos/${id}`, { method: 'DELETE' }),
  probarPregunta: (pregunta: string) =>
    pedir<ResultadoPrueba>('/conocimiento/probar', { method: 'POST', body: JSON.stringify({ pregunta }) }),
  importarConocimiento: () =>
    pedir<{ creados: Array<{ titulo: string; servicioId: string | null }>; omitidos: string[]; sinServicio: string[] }>(
      '/conocimiento/importar', { method: 'POST' }),
  importacionesKb: () => pedir<ImportacionKb[]>('/conocimiento/importaciones'),
  preguntasPendientes: () => pedir<PreguntaPendiente[]>('/conocimiento/pendientes'),
  articuloDesdePendiente: (id: string) =>
    pedir<Articulo>(`/conocimiento/pendientes/${id}/articulo`, { method: 'POST' }),
  descartarPendiente: (id: string) =>
    pedir<PreguntaPendiente>(`/conocimiento/pendientes/${id}/descartar`, { method: 'POST' }),

  interesados: () => pedir<Interesado[]>('/bandeja/interesados'),
  pacientes: (q: string) => pedir<{ datos: Paciente[]; total: number }>(`/pacientes?q=${encodeURIComponent(q)}`),
  crearPaciente: (cuerpo: unknown) => pedir<Paciente>('/pacientes', { method: 'POST', body: JSON.stringify(cuerpo) }),
  historial: (id: string) => pedir<HistorialItem[]>(`/pacientes/${id}/historial`),

  bandeja: (f: FiltrosBandeja = {}) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
    return pedir<Pagina<Conversacion>>(`/bandeja${q.size ? `?${q}` : ''}`);
  },
  /** Si al paciente le llegó el aviso de su cita, y si no, por qué (fase 16). */
  contactoDeCita: (id: string) => pedir<ContactoCita>(`/citas/${id}/contacto`),
  /**
   * Abre conversación con quien nunca ha escrito, mandándole la plantilla que le pide
   * que conteste. Responde 200 con el desenlace: no es un error que ya hubiera hilo.
   */
  abrirConversacion: (pacienteId: string, citaId?: string) =>
    pedir<AperturaConversacion>('/bandeja', {
      method: 'POST', body: JSON.stringify({ pacienteId, citaId }),
    }),
  bandejaConteo: () => pedir<{ pendientes: number; sonido: boolean }>('/bandeja/pendientes/conteo'),
  conversacion: (id: string) => pedir<ConversacionDetalle>(`/bandeja/${id}`),
  tomarBandeja: (id: string) => pedir<Conversacion>(`/bandeja/${id}/tomar`, { method: 'PATCH' }),
  soltarBandeja: (id: string) => pedir<Conversacion>(`/bandeja/${id}/soltar`, { method: 'PATCH' }),
  reabrirBandeja: (id: string) => pedir<Conversacion>(`/bandeja/${id}/reabrir`, { method: 'PATCH' }),
  /** Con la ventana cerrada, lo único que Meta acepta. No la abre: la abre su respuesta. */
  plantillaBandeja: (id: string) =>
    pedir<{ enviado: boolean; plantilla: string }>(`/bandeja/${id}/plantilla`, { method: 'POST' }),
  responderBandeja: (id: string, texto: string) =>
    pedir<{ enviado: boolean }>(`/bandeja/${id}/responder`, { method: 'POST', body: JSON.stringify({ texto }) }),
  resolverBandeja: (id: string) => pedir<Conversacion>(`/bandeja/${id}/resolver`, { method: 'PATCH' }),
  /** RN-08.1 · el soporte que mandó el paciente, para que la asistente pueda leerlo. */
  mediaMensaje: (mensajeId: string) => pedirBlob(`/bandeja/mensajes/${mensajeId}/media`),

  // ── Administración ──
  paciente: (id: string) => pedir<Paciente>(`/pacientes/${id}`),
  actualizarPaciente: (id: string, cuerpo: object) =>
    pedir<Paciente>(`/pacientes/${id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) }),

  prestador: (id: string) => pedir<PrestadorDetalle>(`/prestadores/${id}`),
  crearPrestador: (cuerpo: object) => pedir<PrestadorDetalle>('/prestadores', { method: 'POST', body: JSON.stringify(cuerpo) }),
  actualizarPrestador: (id: string, cuerpo: object) =>
    pedir<PrestadorDetalle>(`/prestadores/${id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) }),

  crearServicio: (cuerpo: object) => pedir<Servicio>('/servicios', { method: 'POST', body: JSON.stringify(cuerpo) }),
  actualizarServicio: (id: string, cuerpo: object) =>
    pedir<Servicio>(`/servicios/${id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) }),

  agendas: (prestadorId?: string) => pedir<Agenda[]>(`/agendas${prestadorId ? `?prestadorId=${prestadorId}` : ''}`),
  crearAgenda: (cuerpo: object) => pedir<Agenda>('/agendas', { method: 'POST', body: JSON.stringify(cuerpo) }),
  programacionMensual: (cuerpo: object) =>
    pedir<{ programadas: number }>('/agendas/programacion-mensual', { method: 'POST', body: JSON.stringify(cuerpo) }),
  bloquearAgenda: (id: string, motivo: string, confirmar: boolean) =>
    pedir<ResultadoBloqueo>(`/agendas/${id}/bloquear`, { method: 'POST', body: JSON.stringify({ motivo, confirmar }) }),
  desbloquearAgenda: (id: string) => pedir<Agenda>(`/agendas/${id}/desbloquear`, { method: 'POST' }),

  // RN-06.5 · días en que la sede no atiende
  diasNoLaborables: (anio: number) => pedir<DiaNoLaborable[]>(`/dias-no-laborables?anio=${anio}`),
  crearDiaNoLaborable: (cuerpo: { fecha: string; motivo: string; confirmar?: boolean }) =>
    pedir<ResultadoDiaNoLaborable>('/dias-no-laborables', { method: 'POST', body: JSON.stringify(cuerpo) }),
  importarFestivos: (anio: number) =>
    pedir<{ anio: number; importados: number; yaEstaban: number }>('/dias-no-laborables/importar-festivos', {
      method: 'POST', body: JSON.stringify({ anio }),
    }),
  eliminarDiaNoLaborable: (id: string) =>
    pedir<{ eliminado: boolean; fecha: string }>(`/dias-no-laborables/${id}`, { method: 'DELETE' }),

  cargas: () => pedir<TrabajoCarga[]>('/carga'),
  carga: (jobId: string) => pedir<TrabajoCarga>(`/carga/${jobId}`),

  auditoria: (pagina: number, entidad?: string) =>
    pedir<{ datos: RegistroAuditoria[]; total: number; paginas: number }>(
      `/auditoria?pagina=${pagina}${entidad ? `&entidad=${encodeURIComponent(entidad)}` : ''}`),

  configuracion: () => pedir<Record<string, string>>('/configuracion'),
  fijarConfiguracion: (clave: string, valor: string) =>
    pedir<{ clave: string; valor: string }>(`/configuracion/${clave}`, { method: 'PUT', body: JSON.stringify({ valor }) }),

  pantallas: () => pedir<Pantalla[]>('/pantallas'),
  actualizarPantalla: (id: string, cuerpo: object) =>
    pedir<Pantalla>(`/pantallas/${id}`, { method: 'PATCH', body: JSON.stringify(cuerpo) }),

  kiosko: () => pedir<EstadoKiosko>('/kiosko/estado'),

  /** RN-10.1 · el enlace público del portal; el QR lo sirve /portal/qr.png. */
  enlacePortal: () => pedir<{ url: string }>('/portal/enlace'),

  cola: (prestadorId?: string) => pedir<Turno[]>(`/turnos${prestadorId ? `?prestadorId=${prestadorId}` : ''}`),
  /** `cobro` es obligatorio desde RN-07.6: la constancia viaja con la llegada. */
  registrarLlegada: (cuerpo: {
    codigo?: string; documento?: string; consultorio?: string;
    cobro: Cobro; cobroNota?: string;
  }) => pedir<Turno>('/turnos/llegada', { method: 'POST', body: JSON.stringify(cuerpo) }),
  llamarSiguiente: (prestadorId: string) =>
    pedir<Turno>('/turnos/llamar-siguiente', { method: 'POST', body: JSON.stringify({ prestadorId }) }),
  priorizar: (id: string, prioridad: string, nota: string) =>
    pedir<Turno>(`/turnos/${id}/priorizar`, { method: 'PATCH', body: JSON.stringify({ prioridad, nota }) }),
  finalizar: (id: string) => pedir<Turno>(`/turnos/${id}/finalizar`, { method: 'PATCH' }),
  // ── Perfiles y usuarios ──
  permisos: () => pedir<DefinicionPermiso[]>('/acceso/permisos'),
  perfiles: () => pedir<Perfil[]>('/acceso/perfiles'),
  crearPerfil: (p: { nombre: string; descripcion?: string; permisos: string[] }) =>
    pedir<Perfil>('/acceso/perfiles', { method: 'POST', body: JSON.stringify(p) }),
  actualizarPerfil: (id: string, p: Partial<{ nombre: string; descripcion: string; permisos: string[]; activo: boolean }>) =>
    pedir<Perfil>(`/acceso/perfiles/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  eliminarPerfil: (id: string) =>
    pedir<{ eliminado: boolean }>(`/acceso/perfiles/${id}`, { method: 'DELETE' }),

  usuariosAdmin: () => pedir<UsuarioAdmin[]>('/acceso/usuarios'),
  crearUsuarioAdmin: (u: { email: string; nombre: string; rol: string; perfilId: string; prestadorId?: string }) =>
    pedir<ClaveEmitida>('/acceso/usuarios', { method: 'POST', body: JSON.stringify(u) }),
  /**
   * `prestadorId: null` QUITA la ficha; omitirlo la deja como está (RN-06.2). Si se
   * colapsaran, guardar el nombre de un médico le arrancaría su ficha.
   */
  actualizarUsuarioAdmin: (
    id: string,
    u: Partial<{ nombre: string; perfilId: string; activo: boolean; rol: string; prestadorId: string | null }>,
  ) =>
    pedir<UsuarioAdmin>(`/acceso/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(u) }),
  reiniciarClave: (id: string) =>
    pedir<ClaveEmitida>(`/acceso/usuarios/${id}/clave`, { method: 'POST' }),
};

// ── Tipos de la API ──
export interface Paciente { id: string; documento: string; nombres: string; apellidos: string; telefono: string | null; condiciones: string[]; origen: string }
export interface HistorialItem { id: string; fecha: string; servicioTexto: string }
export interface Prestador { id: string; nombre: string; especialidad: string; grupoBalanceo: boolean; consultorio: string | null }
export interface Servicio {
  id: string; nombre: string; categoria: string; tipo: string;
  duracionMin: number; cupos: number;
  requiereOrden?: boolean; politicaCosto?: string; activo?: boolean;
  /** Ficha comercial (RN-04.5.1) · sin descripción ni beneficios el bot no lo ofrece. */
  descripcionComercial?: string | null;
  beneficios?: string[];
  preparacion?: string | null;
  enlaceInfo?: string | null;
  rangoPrecio?: string | null;
  agendable?: boolean;
}

/** RN-04.5.4 · lo que arrastra desactivar un servicio. */
export interface ImpactoBaja {
  citas: number;
  citasVigentes: number;
  seguimientosCancelados: number;
  articulosParaRevisar: number;
}

/** RN-13 · artículo de la base de conocimiento. */
export interface Articulo {
  id: string; titulo: string; categoria: string; contenidoMd: string;
  servicioId: string | null; estado: 'borrador' | 'publicado' | 'archivado';
  version: number; requiereRevision: boolean; actualizadoEn: string;
  _count?: { fragmentos: number };
}

export interface FragmentoRecuperado {
  fragmentoId: string; articuloId: string;
  titulo: string; version: number;
  /** Con qué servicio está vinculado el artículo. De aquí sale el ofrecimiento
   *  de cita: las cifras las pone la ficha del catálogo, nunca el texto (RN-13.1). */
  servicioId: string | null;
  texto: string; puntaje: number;
}

/** Un artículo con su troceado, tal como quedó en el índice. */
export interface ArticuloDetalle extends Articulo {
  tags: string[];
  vigenteHasta: string | null;
  fragmentos: Array<{ id: string; orden: number; texto: string; tokens: number }>;
}

/** Todo lo que la pantalla de Base de conocimiento pinta, en una sola petición. */
export interface ResumenConocimiento {
  articulos: { publicados: number; borradores: number; archivados: number; requierenRevision: number };
  pendientesAbiertas: number;
  seguimientosActivos: number;
  resolucionSinHumano: { porcentaje: number; conversaciones: number; dias: number };
  parametros: {
    umbral: number;
    topK: number;
    temas: string[];
    seguimiento: {
      activo: boolean;
      pasos: Array<{ paso: string; minutos: number }>;
      horaApertura: number;
      horaCierre: number;
    };
  };
}

/** Estado de una importación de documento en cola. */
export interface ImportacionKb {
  id: string;
  archivo: string;
  estado: string;
  progreso: number | { procesados: number; total: number };
  resumen: {
    totalBloques: number; creados: number; omitidos: number;
    sinServicio: string[]; erroneos: number;
  } | null;
  error?: string | null;
}

export type ResultadoPrueba =
  | { tipo: 'bloqueada'; tema: string }
  | { tipo: 'sin_cobertura'; mejorPuntaje: number; fragmentos: FragmentoRecuperado[] }
  | { tipo: 'respondida'; mejorPuntaje: number; fragmentos: FragmentoRecuperado[] };

export interface PreguntaPendiente {
  id: string; preguntaEjemplo: string; ocurrencias: number;
  estado: string; actualizadoEn: string;
}

/** RN-09.9.8 · interesado sin agendar, con el paso de su secuencia. */
export interface Interesado {
  conversacionId: string; telefono: string; paciente: string | null;
  servicio: string; desde: string;
  enviados: number; totalPasos: number;
  proximoPaso: string | null; proximoEnvio: string | null;
}
export interface Cita {
  id: string; codigo: string; tipo: string; fecha: string; horaInicio: number; duracionMin: number;
  estado: string; origen: string; observacion: string | null;
  /** Campo propio: antes el motivo pisaba la observación de quien agendó. */
  motivoCancelacion?: string | null;
  /** Presente = la llegada ya se registró. El mostrador lo usa para reimprimir. */
  turno?: TurnoBasico | null;
  paciente: Paciente; prestador: Prestador; servicio: Servicio;
}
export interface Cupo { prestadorId: string; prestadorNombre: string; fecha: string; hora: string; duracionMin: number; consultorio: string | null }
/** RN-07.6 · Qué se hizo con el cobro. Sin importes: la plataforma no maneja dinero. */
export type Cobro = 'cobrado' | 'exento';

/** El turno sin su cita, que es como viene colgado de ella (y evita el tipo circular). */
export interface TurnoBasico {
  id: string; estado: string; prioridad: string; llegadaTs: string; consultorio: string | null;
  notaPriorizacion: string | null;
  /** `null` = no consta (llegadas anteriores a la regla), NO «no se cobró». */
  cobro?: Cobro | null;
  cobroNota?: string | null;
  cobroTs?: string | null;
}
export interface Turno extends TurnoBasico {
  minutosEsperando?: number; cita: Cita;
}
export interface Reporte extends Resumen {
  porServicio: Array<{ servicio: string; citas: number }>;
  porPrestador: Array<{ prestador: string; citas: number }>;
  whatsapp: {
    conversaciones: number; escaladas: number;
    resueltasPorIa: number; porcentajeResolucionIa: number;
  };
}

/** Forma de todo listado paginado del backend (`armarPagina`). */
export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

/** Quién atiende o quién escribió. Solo el nombre: no hace falta su ficha. */
export interface Asistente {
  id: string;
  nombre: string;
}

export interface Conversacion {
  id: string;
  telefono: string;
  paciente: { id: string; nombres: string; apellidos: string; documento: string } | null;
  motivo: string | null;
  prioridad: string;
  intencion: string | null;
  tomadaPor: string | null;
  /** Con nombre: con el id suelto la lista solo podía decir "En gestión". */
  asistente: Asistente | null;
  estado: string;
  resueltaTs: string | null;
  reabiertaTs: string | null;
  reaperturas: number;
  /** RN-08.3 - para que la espera no se vuelva paisaje. */
  minutosEsperando: number;
  ultimoMensaje: string | null;
}

export interface MensajeConversacion {
  id: string;
  direccion: 'entrante' | 'saliente';
  tipo: string;
  contenido: string | null;
  transcripcion: string | null;
  mediaPath: string | null;
  ts: string;
  /** Nulo en un saliente = no lo escribió una persona: el bot o un automatismo. */
  autor: Asistente | null;
}

/**
 * Lo que decide si se puede escribir. Viene en el detalle para poder decirlo ANTES
 * de que la asistente redacte: enterarse al pulsar enviar es enterarse tarde.
 */
export interface VentanaMeta {
  dentro: boolean;
  ultimoEntranteTs: string | null;
  expiraTs: string | null;
  plantillaConfigurada: boolean;
}

export interface ConversacionDetalle extends Omit<Conversacion, 'ultimoMensaje'> {
  mensajes: MensajeConversacion[];
  ventana: VentanaMeta;
}

/**
 * Hechos sobre si se le pudo avisar al paciente. La frase la arma la interfaz: aquí
 * no hay texto para el usuario, porque quien sabe a quién se lo dice es la pantalla.
 */
export interface ContactoCita {
  telefono: string | null;
  /** Sin un solo mensaje entrante no hay ventana que abrir: es el motivo más común. */
  nuncaHaEscrito: boolean;
  /** Si no, WhatsApp no deja salir un primer mensaje y «Escribirle» va deshabilitado. */
  plantillaContactoConfigurada: boolean;
  ventana: { dentro: boolean; ultimoEntranteTs: string | null; expiraTs: string | null };
  conversacion: { id: string; estado: string; resuelta: boolean } | null;
  /** La última fila de auditoría sobre esta cita. `null` = todavía no consta. */
  ultimoEnvio: { accion: string; detalle: string | null; ts: string } | null;
}

export interface AperturaConversacion {
  conversacionId: string;
  creada: boolean;
  reabierta: boolean;
  plantilla: 'enviada' | 'sin_configurar' | 'ventana_abierta' | 'ya_enviada';
}

export interface FiltrosBandeja {
  vista?: 'pendientes' | 'cerradas' | 'todas';
  q?: string;
  desde?: string;
  hasta?: string;
  pagina?: number;
}

export interface PrestadorDetalle extends Prestador {
  vinculacion: string;
  activo: boolean;
  servicios: Array<{ servicioId: string; duracionMin: number; servicio: Servicio }>;
  config: { ventanaControlDias: number } | null;
}

export interface Agenda {
  id: string;
  prestadorId: string;
  modo: 'semanal' | 'calendario';
  diasSemana: number[];
  fecha: string | null;
  horaIni: string;
  horaFin: string;
  slotMin: number;
  servicioId: string | null;
  consultorio: string | null;
  activa: boolean;
  bloqueada: boolean;
  motivoBloqueo: string | null;
  prestador?: Prestador;
  servicio?: Servicio | null;
}

export interface ResultadoBloqueo {
  simulacion: boolean;
  citasAfectadas: number;
  citas: Cita[];
  mensaje: string;
}

/** RN-06.5 · un día en que la sede no atiende. */
export interface DiaNoLaborable {
  id: string;
  fecha: string;
  motivo: string;
  tipo: 'festivo' | 'cierre';
}

export interface ResultadoDiaNoLaborable {
  simulacion: boolean;
  citasAfectadas: number;
  citas: Array<{
    id: string; codigo: string; horaInicio: number;
    paciente: { nombres: string; apellidos: string; telefono: string | null };
    prestador: { nombre: string };
    servicio: { nombre: string };
  }>;
  mensaje: string;
}

export interface TrabajoCarga {
  id: string;
  archivo: string;
  estado: string;
  progreso: number | { procesadas: number };
  resumen: {
    totalFilas: number; creados: number; actualizados: number;
    duplicadosRechazados: number; fueraDeFiltro: number; erroneos: number;
    historialesCreados: number;
  } | null;
}

export interface RegistroAuditoria {
  id: string; ts: string; usuario: string; accion: string;
  entidad: string; detalle: string | null;
  estadoPrev: string | null; estadoNext: string | null;
}

export interface Pantalla {
  id: string; nombre: string; servicios: string[]; turnosVisibles: number;
  sonido: boolean; mensaje: string | null; media: boolean;
  canalYoutube: string | null; videosPromo: string[]; intervaloInstitucionalMin: number;
}

export interface EstadoKiosko {
  activo: boolean;
  mensaje: string | null;
  opciones: Array<{ id: string; etiqueta: string }>;
}

export interface CargaMedico {
  prestadorId: string; nombre: string; consultasGenerales: number; controles: number;
  ocupacionPorcentaje: number; minutosJornada: number; minutosOcupados: number;
}
export interface Resumen {
  rango: { desde: string; hasta: string };
  citas: { total: number; porEstado: Record<string, number>; porTipo: Record<string, number>; porOrigen: Record<string, number> };
  sala: { llegadas: number; enEspera: number; esperaPromedioMin: number };
  kiosko: { activo: boolean; llegadas: number; nota: string };
}

/**
 * Fecha de HOY en la zona de la sede (Cali, UTC−5). El navegador de una asistente
 * puede tener otra zona configurada; el día operativo es siempre el de la sede.
 */
export const hoyEnSede = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

/** El motor trabaja en minutos desde medianoche; la UI muestra HH:MM. */
export const aHora = (minutos: number): string =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

export const hoyIso = hoyEnSede;
