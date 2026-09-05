import { previsualizacion, resumenDeFila } from '@provivir/shared';
import type { Conversacion } from '../../api';

const COLOR: Record<string, string> = { alta: 't-red', media: 't-amber' };

/**
 * La lista de la izquierda. Tres líneas por conversación, al estilo WhatsApp.
 *
 * La **prioridad va la primera**, delante del nombre, y no es decoración: desde que la
 * lista se ordena por actividad reciente, el orden ya no la codifica, así que el chip
 * es la única señal que queda de que alguien es urgente.
 *
 * La segunda línea es el último mensaje. Es el dato que la asistente quiere de un
 * vistazo y que la tabla anterior no pintaba, pese a que la API ya lo devolvía.
 */
export function ListaConversaciones({ filas, usuarioId, activaId, onAbrir, vacio }: {
  filas: Conversacion[];
  usuarioId: string;
  activaId: string | null;
  onAbrir: (id: string) => void;
  vacio: string;
}) {
  if (filas.length === 0) return <p className="empty">{vacio}</p>;

  return (
    <ul className="lista-conv">
      {filas.map((c) => {
        const r = resumenDeFila(c, usuarioId);
        return (
          <li key={c.id}>
            <button
              className={`fila-conv${c.id === activaId ? ' fila-activa' : ''}`}
              onClick={() => onAbrir(c.id)}
              title={r.detalle}
            >
              <span className="fc-l1">
                <span className={`tag ${COLOR[c.prioridad] ?? 't-gray'}`}>{c.prioridad}</span>
                <span className="fc-nombre">{r.titulo}</span>
                <span className={`fc-cuando${r.esperaLarga ? ' espera-larga' : ''}`}>{r.cuando}</span>
              </span>

              <span className="fc-prev">{previsualizacion(c.ultimoMensaje, c.ultimoMensajeTipo)}</span>

              <span className="fc-l3">
                <span className="fc-motivo">{c.motivo ?? 'Sin escalar'}</span>
                {c.reaperturas > 0 && <span className="tag t-gray">reabierta</span>}
                <span className="fc-atiende">{r.atiende ?? 'Sin tomar'}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
