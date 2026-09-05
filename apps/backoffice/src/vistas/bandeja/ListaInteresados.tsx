import { cuandoSale } from '@provivir/shared';
import type { Interesado } from '../../api';

const ETIQUETA: Record<string, string> = {
  seguimiento_1: 'Seguimiento 1',
  seguimiento_2: 'Seguimiento 2',
  cierre: 'Cierre',
};

/**
 * RN-09.9.8 · Interesados sin agendar, ahora dentro de la misma lista.
 *
 * Antes eran una tabla aparte debajo de todo, con un botón «Escribirle yo» que abría el
 * mismo modal. Ahora la fila entera abre su conversación a la derecha, como cualquier
 * otra: una sola lista y un solo sitio donde mirar.
 *
 * Misma anatomía de tres líneas que las conversaciones, para que el ojo no tenga que
 * cambiar de gramática al pulsar el chip.
 */
export function ListaInteresados({ filas, activaId, onAbrir }: {
  filas: Interesado[];
  activaId: string | null;
  onAbrir: (id: string) => void;
}) {
  if (filas.length === 0) {
    return (
      <p className="empty">
        Nadie pendiente. Cuando alguien pregunte por un servicio y no agende, aparecerá aquí
        con el estado de su secuencia de seguimiento.
      </p>
    );
  }

  return (
    <ul className="lista-conv">
      {filas.map((f) => (
        <li key={f.conversacionId}>
          <button
            className={`fila-conv${f.conversacionId === activaId ? ' fila-activa' : ''}`
              + (f.proximoPaso ? '' : ' inactiva')}
            onClick={() => onAbrir(f.conversacionId)}
            title="Escribirle yo"
          >
            <span className="fc-l1">
              <span className="fc-nombre">{f.paciente ?? f.telefono}</span>
              <span className="fc-cuando">
                {f.proximoPaso ? cuandoSale(f.proximoEnvio) : 'agotada'}
              </span>
            </span>

            <span className="fc-prev">{f.servicio}</span>

            <span className="fc-l3">
              {f.proximoPaso
                ? <span className="tag t-blue">{ETIQUETA[f.proximoPaso] ?? f.proximoPaso}</span>
                : <span className="tag t-gray">secuencia agotada</span>}
              <span className="fc-motivo">{f.enviados} de {f.totalPasos} enviados</span>
              <span className="fc-atiende">
                preguntó {new Date(f.desde).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
