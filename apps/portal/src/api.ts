export interface Servicio {
  id: string; nombre: string; categoria: string; duracionMin: number; requiereOrden: boolean;
  /** RN-04.7 · false = lo coordina una asistente; el portal no ofrece horarios. */
  agendable: boolean;
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

import { tokenCaptcha } from './turnstile';

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

/**
 * Igual que `pedir`, pero adjunta un token de CAPTCHA. Se reserva para las tres
 * operaciones que el backend protege: identificar, registrar y agendar. Consultar
 * cupos no lo lleva —es solo lectura y el paciente la repite mucho mientras
 * busca hora—, así que pedir un token ahí solo añadiría fricción.
 *
 * El token es de un solo uso: se obtiene uno por llamada, no uno por sesión.
 */
async function pedirProtegido<T>(ruta: string, cuerpo: object): Promise<T> {
  const captcha = await tokenCaptcha();
  return pedir<T>(ruta, { ...cuerpo, ...(captcha ? { captcha } : {}) });
}

type Sesion = { sesion: string; paciente: { nombres: string; apellidos: string } };

export const api = {
  aviso: () => pedir<Aviso>('/aviso-privacidad'),
  servicios: () => pedir<Servicio[]>('/servicios'),
  identificar: (documento: string, telefonoUltimos4: string) =>
    pedirProtegido<Sesion>('/identificar', { documento, telefonoUltimos4 }),
  registrar: (datos: object) =>
    pedirProtegido<Sesion>('/registrar', { ...datos, aceptaPrivacidad: 'si' }),
  cupos: (servicioId: string, fecha: string) => pedir<Cupo[]>('/cupos', { servicioId, fecha, limite: 12 }),
  agendar: (cuerpo: object) =>
    pedirProtegido<{ creada: boolean; confirmacion?: Confirmacion; motivo?: string; alternativas?: Cupo[] }>('/agendar', cuerpo),
};

/** El día operativo es el de la sede (Cali, UTC−5), no el del navegador del paciente. */
export const hoyEnSede = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

/**
 * RN-04.6 · Primera fecha que el portal puede ofrecer: por defecto mañana.
 *
 * Es solo comodidad de interfaz — el `min` de un input no impide teclear una fecha,
 * y el navegador no manda aquí. La garantía está en el motor, que rechaza la fecha
 * y devuelve el motivo real.
 */
export const primeraFechaAgendable = (): string => {
  const manana = new Date(`${hoyEnSede()}T00:00:00Z`);
  manana.setUTCDate(manana.getUTCDate() + 1);
  return manana.toISOString().slice(0, 10);
};

export const fechaLarga = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
