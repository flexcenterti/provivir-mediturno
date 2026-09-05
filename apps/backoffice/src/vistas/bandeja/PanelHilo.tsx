import { useState } from 'react';
import { api, type ConversacionDetalle, type VentanaMeta } from '../../api';
import { Chat } from './Chat';

/**
 * Qué se puede hacer con esta conversación, en una sola frase.
 *
 * Se calcula aquí y no en cada botón para que el aviso y lo que está habilitado no
 * puedan contradecirse: la asistente tiene que saber por qué no puede escribir antes
 * de redactar, no después de pulsar enviar.
 */
export function situacion(cerrada: boolean, v: VentanaMeta) {
  if (v.dentro) {
    return cerrada
      ? { puedeEscribir: false, reabrir: true, plantilla: false,
          aviso: 'Cerrada, pero el paciente escribió hace menos de 24 h: reábrela y respóndele con normalidad.' }
      : { puedeEscribir: true, reabrir: false, plantilla: false, aviso: '' };
  }
  if (v.plantillaConfigurada) {
    return {
      puedeEscribir: false, reabrir: cerrada, plantilla: true,
      aviso: 'Pasaron más de 24 h desde el último mensaje del paciente. WhatsApp ya no admite texto libre: '
        + 'envíale la plantilla aprobada. Ojo, la plantilla no reabre la ventana — la reabre su respuesta.',
    };
  }
  return {
    puedeEscribir: false, reabrir: cerrada, plantilla: false,
    aviso: 'Pasaron más de 24 h desde el último mensaje del paciente y no hay plantilla configurada, '
      + 'así que WhatsApp no dejará salir nada. Se configura en Administración → Reglas, con el nombre aprobado en Meta.',
  };
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

/**
 * El hilo abierto, a la derecha y sin modal.
 *
 * Las seis acciones se reparten por su naturaleza, no por comodidad: **la ventana de
 * 24 h gobierna el pie** (responder, reabrir, plantilla — lectura directa de
 * `situacion()`) y **el estado de la conversación gobierna la cabecera** (tomar,
 * devolver, resolver). Nada se esconde tras un menú.
 */
export function PanelHilo({ conversacion, usuarioId, onCambio, onResuelta, onVolver }: {
  conversacion: ConversacionDetalle;
  usuarioId: string;
  onCambio: () => void;
  onResuelta: () => void;
  onVolver: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const cerrada = conversacion.resueltaTs !== null;
  const { puedeEscribir, reabrir, plantilla, aviso } = situacion(cerrada, conversacion.ventana);

  /** Toda acción sobre la conversación falla igual: se pinta y no se pierde el texto. */
  async function accion(fn: () => Promise<unknown>, despues: () => void = onCambio) {
    setEnviando(true); setError('');
    try {
      await fn();
      despues();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setEnviando(false);
    }
  }

  const enviar = () =>
    accion(async () => {
      await api.responderBandeja(conversacion.id, texto.trim());
      setTexto('');
    });

  const puedeEnviar = puedeEscribir && !enviando && texto.trim().length > 0;

  return (
    <section className="card plano bandeja-hilo">
      <div className="hd">
        <button className="btn btn-sm btn-ghost bandeja-volver" onClick={onVolver}>
          ← Conversaciones
        </button>
        <div className="hilo-cab">
          <h3>
            {conversacion.paciente
              ? `${conversacion.paciente.nombres} ${conversacion.paciente.apellidos}`
              : conversacion.telefono}
          </h3>
          <p className="nota">
            {conversacion.paciente && <>{conversacion.telefono} · </>}
            {conversacion.motivo ?? 'Sin escalar'}
            {cerrada
              ? <> · cerrada el {fechaCorta(conversacion.resueltaTs!)}</>
              : <> · esperando {conversacion.minutosEsperando} min</>}
            {conversacion.asistente && (
              <> · atiende <b>{conversacion.asistente.nombre}</b>
                {conversacion.tomadaPor === usuarioId ? ' (tú)' : ''}</>
            )}
            {conversacion.reaperturas > 0 && <> · reabierta {conversacion.reaperturas} vez(ces)</>}
          </p>
        </div>

        {!cerrada && (
          <div className="acciones-fila">
            {!conversacion.tomadaPor && (
              <button className="btn btn-sm btn-ghost" disabled={enviando}
                      onClick={() => accion(() => api.tomarBandeja(conversacion.id))}>
                Tomar
              </button>
            )}
            {conversacion.tomadaPor === usuarioId && (
              <button className="btn btn-sm btn-ghost" disabled={enviando}
                      onClick={() => accion(() => api.soltarBandeja(conversacion.id))}>
                Devolver a la bandeja
              </button>
            )}
            <button className="btn btn-sm btn-ghost" disabled={enviando}
                    onClick={() => accion(() => api.resolverBandeja(conversacion.id), onResuelta)}>
              Marcar como resuelta
            </button>
          </div>
        )}
      </div>

      {(aviso || (!cerrada && conversacion.estado === 'ia_activa')) && (
        <div className="hilo-avisos">
          {aviso && <div className="aviso-ventana">{aviso}</div>}
          {!cerrada && conversacion.estado === 'ia_activa' && (
            <div className="aviso-ventana">
              Esta conversación la lleva el bot. Si la tomas o le escribes, deja de contestarle al
              paciente y pasa a atenderla tú.
            </div>
          )}
        </div>
      )}

      <Chat conversacionId={conversacion.id} mensajes={conversacion.mensajes} />

      <div className="redactor">
        {/* El error va aquí y no arriba: con un hilo largo scrolleado, un aviso sobre el
            chat queda fuera de vista justo cuando acabas de pulsar enviar. */}
        {error && <div className="error">{error}</div>}

        {/*
          * El textarea se pinta siempre, deshabilitado cuando no se puede escribir: que
          * la caja desaparezca deja a la asistente sin saber si el hilo admite respuesta
          * o si la pantalla se rompió. El aviso de arriba dice el porqué.
          */}
        <textarea
          rows={2}
          value={texto}
          disabled={!puedeEscribir}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={puedeEscribir
            ? 'Escribe tu respuesta al paciente…'
            : 'No se puede escribir ahora mismo — mira el aviso de arriba.'}
          onKeyDown={(e) => {
            /*
             * `isComposing` no es opcional: con teclado de acentos o predictivo, Enter
             * confirma la palabra que se está componiendo. Sin la guarda se enviaría el
             * mensaje a medias, con la última palabra sin terminar.
             */
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (puedeEnviar) void enviar();
          }}
        />

        <div className="acciones">
          {puedeEscribir && (
            <>
              <button className="btn btn-primary" onClick={enviar} disabled={!puedeEnviar}>
                {enviando ? 'Enviando…' : 'Responder por WhatsApp'}
              </button>
              <span className="nota">Enter envía · Shift+Enter salto de línea</span>
            </>
          )}
          {reabrir && (
            <button className="btn btn-primary" disabled={enviando}
                    onClick={() => accion(() => api.reabrirBandeja(conversacion.id))}>
              Reabrir y atender
            </button>
          )}
          {plantilla && (
            <button className="btn btn-primary" disabled={enviando}
                    onClick={() => accion(() => api.plantillaBandeja(conversacion.id))}>
              Enviar plantilla para que responda
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
