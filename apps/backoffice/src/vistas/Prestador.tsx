import { useCallback, useEffect, useState } from 'react';
import { api, aHora, type Turno } from '../api';
import { EtiquetaTipo } from './Dashboard';

/**
 * Especificación §2.15 · Vista del prestador (móvil primero).
 * RN-07.3 · el llamado es automático al siguiente en cola.
 * RN-07.4 · para adelantar a alguien hay que priorizar con nota obligatoria.
 */
export function VistaPrestador({ prestadorId }: { prestadorId: string }) {
  const [cola, setCola] = useState<Turno[]>([]);
  const [error, setError] = useState('');
  const [priorizando, setPriorizando] = useState<Turno | null>(null);
  /*
   * El botón se apaga unos segundos tras cada pulsación. Sin eso, una asistente
   * impaciente encadena cuatro anuncios solapados y la sala oye ruido. Se limita aquí
   * y no en el servidor: al servidor no le incumbe con qué ritmo se pulsa un botón.
   */
  const [repitiendo, setRepitiendo] = useState(false);

  const recargar = useCallback(() => {
    api.cola(prestadorId).then(setCola).catch((e) => setError(e.message));
  }, [prestadorId]);

  useEffect(() => {
    recargar();
    const id = setInterval(recargar, 15_000);
    return () => clearInterval(id);
  }, [recargar]);

  async function llamar() {
    setError('');
    try {
      await api.llamarSiguiente(prestadorId);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function repetir(turnoId: string) {
    setError('');
    setRepitiendo(true);
    setTimeout(() => setRepitiendo(false), 3_000);
    try {
      await api.rellamar(turnoId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const enAtencion = cola.find((t) => t.estado === 'llamado');

  return (
    <div className="vista">

      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="acciones">
          <button className="btn btn-primary" onClick={llamar}>Llamar al siguiente</button>
          {enAtencion && (
            <>
              <button className="btn btn-ghost" disabled={repitiendo}
                      onClick={() => void repetir(enAtencion.id)}>
                {repitiendo ? 'Anunciando…' : 'Repetir llamado'}
              </button>
              <button className="btn btn-ghost" onClick={() => api.finalizar(enAtencion.id).then(recargar)}>
                Finalizar atención de {enAtencion.cita.codigo}
              </button>
            </>
          )}
        </div>
        <p className="nota">
          El llamado es automático al siguiente en cola (prioridad, luego orden de llegada).
          Para adelantar a un paciente, tóquelo y deje la nota del motivo.
        </p>
      </div>

      <div className="card">
        <h3>Pacientes del día</h3>
        <TablaCola turnos={cola} onFila={setPriorizando} />
      </div>

      {priorizando && (
        <ModalPriorizar turno={priorizando} onCerrar={() => setPriorizando(null)} onListo={() => { setPriorizando(null); recargar(); }} />
      )}
    </div>
  );
}

/**
 * La cola, en tabla. Se exporta porque la vista de sala pinta exactamente la misma
 * con una columna más: el profesional, que en la cola de un solo médico sobra.
 */
export function TablaCola({ turnos, conProfesional = false, onFila }: {
  turnos: Turno[];
  conProfesional?: boolean;
  onFila: (t: Turno) => void;
}) {
  const columnas = conProfesional ? 8 : 7;

  return (
    <table className="tabla">
      <thead>
        <tr>
          <th>Código</th><th>Paciente</th>
          {conProfesional && <th>Profesional</th>}
          <th>Servicio</th><th>Tipo</th><th>Hora</th><th>Esperando</th><th>Prioridad</th>
        </tr>
      </thead>
      <tbody>
        {turnos.map((t) => (
          <tr key={t.id} className={t.estado === 'llamado' ? 'fila-activa' : 'fila-clickable'}
              onClick={() => onFila(t)}>
            <td><span className="chip">{t.cita.codigo}</span></td>
            <td>{t.cita.paciente.apellidos}, {t.cita.paciente.nombres}</td>
            {conProfesional && <td>{t.cita.prestador.nombre}</td>}
            {/* §2.15 · el prestador debe saber qué viene a cumplir cada paciente */}
            <td>{t.cita.servicio.nombre}</td>
            <td><EtiquetaTipo tipo={t.cita.tipo} /></td>
            <td>{aHora(t.cita.horaInicio)}</td>
            <td>{t.minutosEsperando} min</td>
            <td>
              <span className={`tag ${t.prioridad === 'alta' ? 't-red' : t.prioridad === 'media' ? 't-amber' : 't-gray'}`}>
                {t.prioridad}
              </span>
            </td>
          </tr>
        ))}
        {turnos.length === 0 && <tr><td colSpan={columnas} className="muted">No hay pacientes en espera</td></tr>}
      </tbody>
    </table>
  );
}

/** RN-07.4 · la nota del motivo es obligatoria; el backend también la exige. */
export function ModalPriorizar({ turno, onCerrar, onListo }: { turno: Turno; onCerrar: () => void; onListo: () => void }) {
  const [prioridad, setPrioridad] = useState(turno.prioridad);
  const [nota, setNota] = useState('');
  const [error, setError] = useState('');

  async function guardar() {
    if (nota.trim().length < 5) {
      setError('La nota del motivo es obligatoria (mínimo 5 caracteres)');
      return;
    }
    try {
      await api.priorizar(turno.id, prioridad, nota.trim());
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Priorizar a {turno.cita.paciente.nombres} {turno.cita.paciente.apellidos}</h3>
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>Prioridad</label>
          <select value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </div>

        <div className="field">
          <label>Motivo (obligatorio)</label>
          <textarea rows={3} value={nota} onChange={(e) => setNota(e.target.value)}
                    placeholder="Ej.: dolor agudo, paciente con acompañante que debe retirarse…" />
        </div>

        <p className="nota">El cambio reordena la cola y queda registrado en auditoría.</p>

        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar}>Guardar</button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
