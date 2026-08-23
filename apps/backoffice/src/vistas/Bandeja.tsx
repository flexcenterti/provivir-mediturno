import { useCallback, useEffect, useState } from 'react';
import { api, type Conversacion, type ConversacionDetalle, type Interesado } from '../api';

/**
 * Especificación §2.9 · Bandeja de la asistente.
 * Muestra motivo, prioridad y tiempo esperando; la asistente toma la conversación
 * y responde por WhatsApp sin salir de la plataforma (RN-08.3).
 */
export function Bandeja() {
  const [pendientes, setPendientes] = useState<Conversacion[]>([]);
  const [interesados, setInteresados] = useState<Interesado[]>([]);
  const [abierta, setAbierta] = useState<ConversacionDetalle | null>(null);
  const [error, setError] = useState('');

  const recargar = useCallback(() => {
    api.bandeja().then(setPendientes).catch((e: Error) => setError(e.message));
    // RN-09.9.8 · los interesados van aquí y no en un tablero aparte: es donde la
    // asistente ya trabaja, y un listado en otra pantalla no lo mira nadie.
    api.interesados().then(setInteresados).catch(() => undefined);
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

      <Interesados filas={interesados} onAbrir={(id) => void abrir(id)} />

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

/**
 * RN-09.9.8 · Interesados sin agendar, debajo de las conversaciones escaladas.
 *
 * No suma a la burbuja roja del menú: esa cuenta a quien espera respuesta humana
 * AHORA (RN-08.3), y mezclarlas diluye la señal que hace reaccionar a la asistente.
 */
function Interesados({ filas, onAbrir }: { filas: Interesado[]; onAbrir: (id: string) => void }) {
  const activos = filas.filter((f) => f.proximoPaso !== null);

  const cuando = (iso: string | null) => {
    if (!iso) return '—';
    const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
    if (min <= 0) return 'en cualquier momento';
    if (min < 60) return `en ${min} min`;
    return `en ${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
  };

  const ETIQUETA: Record<string, string> = {
    seguimiento_1: 'Seguimiento 1',
    seguimiento_2: 'Seguimiento 2',
    cierre: 'Cierre',
  };

  return (
    <div className="card">
      <div className="card-cab">
        <h3>Interesados sin agendar</h3>
        <span className="muted">
          {activos.length} en seguimiento · preguntaron por un servicio y no cerraron la cita
        </span>
      </div>

      {filas.length === 0 ? (
        <p className="nota">
          Nadie pendiente. Cuando alguien pregunte por un servicio y no agende, aparecerá aquí con
          el estado de su secuencia de seguimiento.
        </p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Contacto</th><th>Servicio</th><th>Preguntó</th>
              <th>Secuencia</th><th>Próximo mensaje</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.conversacionId} className={f.proximoPaso ? '' : 'inactiva'}>
                <td>{f.paciente ?? <span className="muted">{f.telefono}</span>}</td>
                <td>{f.servicio}</td>
                <td>{new Date(f.desde).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>
                  <span className="muted">{f.enviados} de {f.totalPasos} enviados</span>
                </td>
                <td>
                  {f.proximoPaso
                    ? <>{ETIQUETA[f.proximoPaso] ?? f.proximoPaso} <span className="muted">{cuando(f.proximoEnvio)}</span></>
                    : <span className="muted">secuencia agotada</span>}
                </td>
                <td className="acciones">
                  <button className="btn btn-sm btn-ghost" onClick={() => onAbrir(f.conversacionId)}>
                    Escribirle yo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="nota">
        La plataforma escribe a las 2 h, 5 h y 8 h, siempre dentro del horario de atención, y se
        detiene sola si el paciente responde, agenda por cualquier canal o pide no ser contactado.
        Tomar la conversación también la detiene: lo automático es el piso, no el techo.
      </p>
    </div>
  );
}
