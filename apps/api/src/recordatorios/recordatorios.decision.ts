import { dentroDeVentanaMeta } from '../whatsapp/ventana-meta';

/**
 * Cómo puede salir un envío proactivo de cita (RN-05, RN-10.3).
 *
 * `texto` es siempre preferible —lleva el ticket completo, con consultorio e
 * indicaciones—, pero solo cabe dentro de la ventana de 24 h. Fuera de ella la
 * única opción es la plantilla, y si no hay ninguna aprobada **no se intenta**:
 * Meta lo rechazaría con `#131047` y el reintento no cambia nada. Descartar con
 * motivo deja el hecho consultable en auditoría, que es la diferencia entre un
 * recordatorio que no salió y un recordatorio que nadie sabe que no salió.
 *
 * Es la misma decisión que ya tomaba el seguimiento comercial (RN-09.9.6); aquí
 * se escribe una vez, aparte del servicio, para poder probarla sin colas.
 */
export type ModoEnvio =
  | { modo: 'texto' }
  | { modo: 'plantilla'; nombre: string }
  | { modo: 'descartar'; motivo: string };

export function decidirEnvio(opciones: {
  /** Último mensaje ENTRANTE del paciente, o null si nunca ha escrito. */
  ultimoMensajePaciente: Date | null;
  ahora: Date;
  /** Nombre de la plantilla aprobada en Meta. Vacío = no hay ninguna. */
  plantilla: string;
}): ModoEnvio {
  const { ultimoMensajePaciente, ahora, plantilla } = opciones;

  if (ultimoMensajePaciente && dentroDeVentanaMeta(ultimoMensajePaciente, ahora)) {
    return { modo: 'texto' };
  }

  const nombre = plantilla.trim();
  if (nombre) return { modo: 'plantilla', nombre };

  return {
    modo: 'descartar',
    motivo: ultimoMensajePaciente
      ? 'Fuera de la ventana de 24 h de Meta y sin plantilla aprobada'
      : 'El paciente nunca ha escrito por WhatsApp: solo cabía plantilla, y no hay ninguna aprobada',
  };
}
