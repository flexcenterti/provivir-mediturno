export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'asistente' | 'prestador' | 'pantalla';
  prestadorId: string | null;
}

export interface RespuestaLogin {
  accessToken: string;
  refreshToken: string;
  usuario: UsuarioSesion;
}

const CLAVE_TOKEN = 'accessToken';

export const token = {
  leer: () => sessionStorage.getItem(CLAVE_TOKEN),
  guardar: (t: string) => sessionStorage.setItem(CLAVE_TOKEN, t),
  borrar: () => sessionStorage.removeItem(CLAVE_TOKEN),
};

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const t = token.leer();
  const r = await fetch(`/api${ruta}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...init?.headers,
    },
  });

  if (r.status === 401) {
    token.borrar();
    throw new Error('Sesión expirada');
  }
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    throw new Error(cuerpo.message ?? 'Error en la operación');
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export const api = {
  login: (email: string, password: string) =>
    pedir<RespuestaLogin>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  yo: () => pedir<UsuarioSesion>('/auth/yo'),

  resumen: (desde: string, hasta: string) => pedir<Resumen>(`/metricas/resumen?desde=${desde}&hasta=${hasta}`),
  balanceo: (fecha: string) => pedir<CargaMedico[]>(`/metricas/balanceo?fecha=${fecha}`),

  consolidada: (desde: string, hasta: string, prestadorId?: string) =>
    pedir<Cita[]>(`/citas/consolidada?desde=${desde}&hasta=${hasta}${prestadorId ? `&prestadorId=${prestadorId}` : ''}`),
  buscarCitas: (q: string) => pedir<Cita[]>(`/citas/buscar?q=${encodeURIComponent(q)}`),
  cupos: (p: Record<string, string>) => pedir<Cupo[]>(`/cupos?${new URLSearchParams(p)}`),
  crearCita: (cuerpo: unknown) => pedir<{ creada: boolean; cita?: Cita; alternativas?: Cupo[]; motivo?: string }>(
    '/citas', { method: 'POST', body: JSON.stringify(cuerpo) }),

  prestadores: () => pedir<Prestador[]>('/prestadores'),
  servicios: () => pedir<Servicio[]>('/servicios'),
  pacientes: (q: string) => pedir<{ datos: Paciente[]; total: number }>(`/pacientes?q=${encodeURIComponent(q)}`),
  crearPaciente: (cuerpo: unknown) => pedir<Paciente>('/pacientes', { method: 'POST', body: JSON.stringify(cuerpo) }),
  historial: (id: string) => pedir<HistorialItem[]>(`/pacientes/${id}/historial`),

  bandeja: () => pedir<Conversacion[]>('/bandeja'),
  bandejaConteo: () => pedir<{ pendientes: number; sonido: boolean }>('/bandeja/pendientes/conteo'),
  conversacion: (id: string) => pedir<ConversacionDetalle>(`/bandeja/${id}`),
  tomarBandeja: (id: string) => pedir<Conversacion>(`/bandeja/${id}/tomar`, { method: 'PATCH' }),
  responderBandeja: (id: string, texto: string) =>
    pedir<{ enviado: boolean }>(`/bandeja/${id}/responder`, { method: 'POST', body: JSON.stringify({ texto }) }),
  resolverBandeja: (id: string) => pedir<Conversacion>(`/bandeja/${id}/resolver`, { method: 'PATCH' }),

  cola: (prestadorId?: string) => pedir<Turno[]>(`/turnos${prestadorId ? `?prestadorId=${prestadorId}` : ''}`),
  registrarLlegada: (cuerpo: unknown) => pedir<Turno>('/turnos/llegada', { method: 'POST', body: JSON.stringify(cuerpo) }),
  llamarSiguiente: (prestadorId: string) =>
    pedir<Turno>('/turnos/llamar-siguiente', { method: 'POST', body: JSON.stringify({ prestadorId }) }),
  priorizar: (id: string, prioridad: string, nota: string) =>
    pedir<Turno>(`/turnos/${id}/priorizar`, { method: 'PATCH', body: JSON.stringify({ prioridad, nota }) }),
  finalizar: (id: string) => pedir<Turno>(`/turnos/${id}/finalizar`, { method: 'PATCH' }),
};

// ── Tipos de la API ──
export interface Paciente { id: string; documento: string; nombres: string; apellidos: string; telefono: string | null; condiciones: string[]; origen: string }
export interface HistorialItem { id: string; fecha: string; servicioTexto: string }
export interface Prestador { id: string; nombre: string; especialidad: string; grupoBalanceo: boolean; consultorio: string | null }
export interface Servicio { id: string; nombre: string; categoria: string; tipo: string; duracionMin: number; cupos: number }
export interface Cita {
  id: string; codigo: string; tipo: string; fecha: string; horaInicio: number; duracionMin: number;
  estado: string; origen: string; observacion: string | null;
  paciente: Paciente; prestador: Prestador; servicio: Servicio;
}
export interface Cupo { prestadorId: string; prestadorNombre: string; fecha: string; hora: string; duracionMin: number; consultorio: string | null }
export interface Turno {
  id: string; estado: string; prioridad: string; llegadaTs: string; consultorio: string | null;
  notaPriorizacion: string | null; minutosEsperando?: number; cita: Cita;
}
export interface Conversacion {
  id: string;
  telefono: string;
  paciente: { id: string; nombres: string; apellidos: string; documento: string } | null;
  motivo: string | null;
  prioridad: string;
  intencion: string | null;
  tomadaPor: string | null;
  estado: string;
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
}

export interface ConversacionDetalle extends Omit<Conversacion, 'ultimoMensaje'> {
  mensajes: MensajeConversacion[];
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
