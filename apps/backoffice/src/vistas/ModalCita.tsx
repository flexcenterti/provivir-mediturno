import { useCallback, useEffect, useState } from 'react';
import { api, type Cita, type Cupo, type Prestador } from '../api';
import { aHoraLocal } from './Dashboard';

/**
 * Lo que se puede hacer con una cita ya creada: moverla o darla de baja.
 *
 * Los endpoints existían desde la fase 2 y no tenían pantalla, así que el bot de
 * WhatsApp podía cancelar una cita y la asistente no.
 *
 * Los cupos los ofrece el motor, igual que al crear: la UI no calcula reglas. Y como
 * el motor revalida todo dentro de la transacción, lo que devuelva un rechazo es la
 * verdad — se pinta tal cual y se recargan los cupos.
 */
export function ModalCita({ cita, onCerrar, onCambio }: {
  cita: Cita;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const [modo, setModo] = useState<'ficha' | 'mover' | 'cancelar'>('ficha');
  const [fecha, setFecha] = useState(cita.fecha.slice(0, 10));
  const [prestadorId, setPrestadorId] = useState(cita.prestador.id);
  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [cupos, setCupos] = useState<Cupo[]>([]);
  const [motivo, setMotivo] = useState('');
  const [notificar, setNotificar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const viva = !['cancelada', 'atendida'].includes(cita.estado);

  useEffect(() => { api.prestadores().then(setPrestadores).catch(() => undefined); }, []);

  const cargarCupos = useCallback(() => {
    if (modo !== 'mover') return;
    api.cupos({ servicioId: cita.servicio.id, fecha, prestadorId, limite: '20' })
      .then(setCupos)
      .catch((e: Error) => setError(e.message));
  }, [modo, cita.servicio.id, fecha, prestadorId]);
  useEffect(cargarCupos, [cargarCupos]);

  async function mover(cupo: Cupo) {
    setOcupado(true); setError('');
    try {
      await api.reprogramarCita(cita.id, {
        fecha, hora: cupo.hora, prestadorId: cupo.prestadorId,
        motivo: motivo.trim() || undefined, notificar,
      });
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      // El cupo pudo ocuparse entre la oferta y la confirmación.
      cargarCupos();
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar() {
    if (!motivo.trim()) { setError('El motivo es obligatorio'); return; }
    setOcupado(true); setError('');
    try {
      await api.cancelarCita(cita.id, { motivo: motivo.trim(), notificar });
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>Cita {cita.codigo}</h3>
        <p className="nota">
          {cita.paciente.apellidos}, {cita.paciente.nombres} · {cita.servicio.nombre} ·{' '}
          {cita.prestador.nombre} · {cita.fecha.slice(0, 10)} {aHoraLocal(cita.horaInicio)} ·{' '}
          {cita.estado.replace(/_/g, ' ')}
        </p>
        {cita.observacion && <p className="nota">Observación: {cita.observacion}</p>}
        {cita.motivoCancelacion && <p className="nota">Motivo de cancelación: {cita.motivoCancelacion}</p>}

        {error && <div className="error">{error}</div>}

        {!viva && <p className="nota">Esta cita ya no se puede modificar.</p>}

        {viva && modo === 'ficha' && (
          <div className="acciones">
            <button className="btn btn-primary" onClick={() => setModo('mover')}>Cambiar fecha, hora o profesional</button>
            <button className="btn btn-ghost" onClick={() => setModo('cancelar')}>Cancelar la cita</button>
          </div>
        )}

        {viva && modo === 'mover' && (
          <>
            <div className="controles">
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              <select value={prestadorId} onChange={(e) => setPrestadorId(e.target.value)}>
                {prestadores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Motivo (opcional)</label>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se mueve" />
            </div>
            <AvisoAlPaciente notificar={notificar} onCambiar={setNotificar} />

            {cupos.length === 0
              ? <p className="nota">No hay cupos libres ese día con ese profesional.</p>
              : (
                <div className="cupos">
                  {cupos.map((c) => (
                    <button key={`${c.prestadorId}-${c.hora}`} className="cupo"
                            disabled={ocupado} onClick={() => mover(c)}>
                      <strong>{c.hora}</strong>
                      <span>{c.prestadorNombre}</span>
                      <span className="muted">{c.duracionMin} min</span>
                    </button>
                  ))}
                </div>
              )}
            <div className="acciones">
              <button className="btn btn-ghost" onClick={() => setModo('ficha')}>Volver</button>
            </div>
          </>
        )}

        {viva && modo === 'cancelar' && (
          <>
            <div className="field">
              <label>Motivo</label>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por qué se cancela" />
            </div>
            <AvisoAlPaciente notificar={notificar} onCambiar={setNotificar} />
            {/* El cliente dijo "eliminar": conviene que sepa qué pasa de verdad. */}
            <p className="nota">
              La cita no se borra: queda como cancelada y su historial se conserva. El cupo vuelve a
              quedar libre.
            </p>
            <div className="acciones">
              <button className="btn btn-primary" disabled={ocupado || !motivo.trim()} onClick={cancelar}>
                {ocupado ? 'Cancelando…' : 'Confirmar cancelación'}
              </button>
              <button className="btn btn-ghost" onClick={() => setModo('ficha')}>Volver</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Fuera de la ventana de 24 h de Meta el aviso solo sale como plantilla aprobada, y
 * hoy no hay ninguna configurada: se dice aquí para que la asistente sepa que puede
 * tener que llamar por teléfono, en vez de darlo por hecho.
 */
function AvisoAlPaciente({ notificar, onCambiar }: {
  notificar: boolean;
  onCambiar: (v: boolean) => void;
}) {
  return (
    <>
      <label className="p-check">
        <input type="checkbox" checked={notificar} onChange={(e) => onCambiar(e.target.checked)} />
        Avisar al paciente por WhatsApp
      </label>
      <p className="nota">
        {notificar
          ? 'Si hace más de 24 h que no escribe, WhatsApp solo admite plantilla aprobada; sin ella el aviso se descarta y queda en auditoría.'
          : 'Quedará registrado que se decidió no avisarle.'}
      </p>
    </>
  );
}
