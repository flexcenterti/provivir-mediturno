import { useCallback, useEffect, useState } from 'react';
import { api, type Conversacion, type ConversacionDetalle } from '../api';

/**
 * Especificación §2.9 · Bandeja de la asistente.
 * Muestra motivo, prioridad y tiempo esperando; la asistente toma la conversación
 * y responde por WhatsApp sin salir de la plataforma (RN-08.3).
 */
export function Bandeja() {
  const [pendientes, setPendientes] = useState<Conversacion[]>([]);
  const [abierta, setAbierta] = useState<ConversacionDetalle | null>(null);
  const [error, setError] = useState('');

  const recargar = useCallback(() => {
    api.bandeja().then(setPendientes).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    recargar();
    // El tiempo de espera avanza aunque no pase nada: se refresca solo.
    const id = setInterval(recargar, 20_000);
    return () => clearInterval(id);
  }, [recargar]);

  async function abrir(id: string) {
    setError('');
    try {
      setAbierta(await api.conversacion(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="vista">
      <header className="vista-cab">
        <div>
          <h2>Bandeja de la asistente</h2>
          <p className="nota">
            Conversaciones que la IA no resolvió. Ordenadas por prioridad y, dentro de ella,
            por quién lleva más tiempo esperando.
          </p>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <table className="tabla">
          <thead>
            <tr>
              <th>Paciente</th><th>Motivo</th><th>Prioridad</th>
              <th>Tiempo esperando</th><th>Estado</th><th></th>
            </tr>
          </thead>
          <tbody>
            {pendientes.map((c) => (
              <tr key={c.id} className="fila-clickable" onClick={() => abrir(c.id)}>
                <td>
                  {c.paciente ? `${c.paciente.apellidos}, ${c.paciente.nombres}` : <span className="muted">Sin registrar</span>}
                  <br />
                  <span className="muted">{c.telefono}</span>
                </td>
                <td>{c.motivo}</td>
                <td>
                  <span className={`tag ${c.prioridad === 'alta' ? 't-red' : c.prioridad === 'media' ? 't-amber' : 't-gray'}`}>
                    {c.prioridad}
                  </span>
                </td>
                {/* RN-08.3 · para que la espera no "se vuelva paisaje" */}
                <td className={c.minutosEsperando > 30 ? 'espera-larga' : ''}>
                  {c.minutosEsperando} min
                </td>
                <td>{c.tomadaPor ? 'En gestión' : 'Sin tomar'}</td>
                <td><button className="btn btn-ghost">Abrir</button></td>
              </tr>
            ))}
            {pendientes.length === 0 && (
              <tr><td colSpan={6} className="muted">No hay conversaciones pendientes</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {abierta && (
        <ModalConversacion
          conversacion={abierta}
          onCerrar={() => setAbierta(null)}
          onCambio={() => { recargar(); void abrir(abierta.id); }}
          onResuelta={() => { setAbierta(null); recargar(); }}
        />
      )}
    </div>
  );
}

function ModalConversacion({ conversacion, onCerrar, onCambio, onResuelta }: {
  conversacion: ConversacionDetalle;
  onCerrar: () => void;
  onCambio: () => void;
  onResuelta: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  async function enviar() {
    if (!texto.trim()) return;
    setEnviando(true); setError('');
    try {
      await api.responderBandeja(conversacion.id, texto.trim());
      setTexto('');
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>
          {conversacion.paciente
            ? `${conversacion.paciente.nombres} ${conversacion.paciente.apellidos}`
            : conversacion.telefono}
        </h3>
        <p className="nota">
          {conversacion.motivo} · esperando {conversacion.minutosEsperando} min
        </p>

        {error && <div className="error">{error}</div>}

        <div className="chat">
          {conversacion.mensajes.map((m) => (
            <div key={m.id} className={`burbuja ${m.direccion === 'entrante' ? 'de-paciente' : 'de-clinica'}`}>
              {/* RN-09.2 · el adjunto del paciente se le muestra a la asistente como soporte */}
              {m.mediaPath && <div className="adjunto">📎 {m.tipo}</div>}
              <span>{m.transcripcion ?? m.contenido ?? `[${m.tipo}]`}</span>
              <time>{new Date(m.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</time>
            </div>
          ))}
        </div>

        <div className="field">
          <textarea
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe tu respuesta al paciente…"
          />
        </div>

        <div className="acciones">
          <button className="btn btn-primary" onClick={enviar} disabled={enviando || !texto.trim()}>
            {enviando ? 'Enviando…' : 'Responder por WhatsApp'}
          </button>
          {!conversacion.tomadaPor && (
            <button className="btn btn-ghost" onClick={() => api.tomarBandeja(conversacion.id).then(onCambio)}>
              Tomar
            </button>
          )}
          <button className="btn btn-ghost" onClick={() => api.resolverBandeja(conversacion.id).then(onResuelta)}>
            Marcar como resuelta
          </button>
        </div>
      </div>
    </div>
  );
}
