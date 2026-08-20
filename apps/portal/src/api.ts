export interface Servicio {
  id: string; nombre: string; categoria: string; duracionMin: number; requiereOrden: boolean;
}
export interface Cupo {
  prestadorId: string; prestadorNombre: string; fecha: string; hora: string;
  duracionMin: number; consultorio: string | null;
}
export interface Confirmacion {
  codigo: string; paciente: string; servicio: string; prestador: string;
  fecha: string; hora: string; duracionMin: number; indicaciones: string;
}
export interface Aviso {
  responsable: string; finalidad: string; derechos: string; base: string; captchaActivo: boolean;
}

async function pedir<T>(ruta: string, cuerpo?: object): Promise<T> {
  const r = await fetch(`/api/portal${ruta}`, {
    method: cuerpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(Array.isArray(d.message) ? d.message[0] : (d.message ?? 'No fue posible completar la operación'));
  }
  return r.json();
}

export const api = {
  aviso: () => pedir<Aviso>('/aviso-privacidad'),
  servicios: () => pedir<Servicio[]>('/servicios'),
  identificar: (documento: string, telefonoUltimos4: string) =>
    pedir<{ sesion: string; paciente: { nombres: string; apellidos: string } }>('/identificar', { documento, telefonoUltimos4 }),
  registrar: (datos: object) =>
    pedir<{ sesion: string; paciente: { nombres: string; apellidos: string } }>('/registrar', { ...datos, aceptaPrivacidad: 'si' }),
  cupos: (servicioId: string, fecha: string) => pedir<Cupo[]>('/cupos', { servicioId, fecha, limite: 12 }),
  agendar: (cuerpo: object) =>
    pedir<{ creada: boolean; confirmacion?: Confirmacion; motivo?: string; alternativas?: Cupo[] }>('/agendar', cuerpo),
};

/** El día operativo es el de la sede (Cali, UTC−5), no el del navegador del paciente. */
export const hoyEnSede = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

export const fechaLarga = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
