import { useEffect, useState } from 'react';
import { api, type HistorialItem, type Paciente } from '../api';

/** Especificación §2.3 · Gestión de pacientes con historial de servicios tomados. */
export function Pacientes() {
  const [q, setQ] = useState('');
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [total, setTotal] = useState(0);
  const [historial, setHistorial] = useState<{ paciente: Paciente; items: HistorialItem[] } | null>(null);
  const [editando, setEditando] = useState<Paciente | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');

  const buscar = async (texto = q) => {
    setError('');
    try {
      const r = await api.pacientes(texto);
      setPacientes(r.datos);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  };

  useEffect(() => { void buscar(''); }, []);

  async function verHistorial(p: Paciente) {
    try {
      setHistorial({ paciente: p, items: await api.historial(p.id) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="vista">
      <header className="vista-cab">
        <div>
          <h2>Pacientes</h2>
          <p className="nota">Búsqueda por documento, nombre o teléfono. {total.toLocaleString('es-CO')} registro(s).</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreando(true)}>Crear paciente</button>
      </header>

      {error && <div className="error">{error}</div>}

      <form className="buscador" onSubmit={(e) => { e.preventDefault(); void buscar(); }}>
        <input placeholder="Documento, nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-primary" type="submit">Buscar</button>
      </form>

      <div className="card">
        <table className="tabla">
          <thead>
            <tr><th>Documento</th><th>Paciente</th><th>Teléfono</th><th>Condiciones</th><th>Origen</th><th></th></tr>
          </thead>
          <tbody>
            {pacientes.map((p) => (
              <tr key={p.id}>
                <td><span className="chip">{p.documento}</span></td>
                <td>{p.apellidos}, {p.nombres}</td>
                <td>{p.telefono ?? <span className="muted">—</span>}</td>
                <td>
                  {p.condiciones.length === 0
                    ? <span className="muted">—</span>
                    : p.condiciones.map((c) => <span key={c} className="tag t-amber">{c}</span>)}
                </td>
                <td className="muted">{p.origen}</td>
                <td className="acciones-fila">
                  {/* RN-12.4 · ventana emergente con los últimos 10 servicios */}
                  <button className="btn btn-ghost" onClick={() => verHistorial(p)}>Historial</button>
                  <button className="btn btn-ghost" onClick={() => setEditando(p)}>Editar</button>
                </td>
              </tr>
            ))}
            {pacientes.length === 0 && <tr><td colSpan={6} className="muted">Sin resultados</td></tr>}
          </tbody>
        </table>
      </div>

      {historial && (
        <div className="modal-fondo" onClick={() => setHistorial(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Servicios tomados</h3>
            <p className="nota">
              {historial.paciente.apellidos}, {historial.paciente.nombres} · últimos 10 servicios,
              sin importar la fecha. No es historia clínica: no se almacenan datos clínicos.
            </p>
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Servicio</th></tr></thead>
              <tbody>
                {historial.items.map((h) => (
                  <tr key={h.id}><td>{h.fecha.slice(0, 10)}</td><td>{h.servicioTexto}</td></tr>
                ))}
                {historial.items.length === 0 && <tr><td colSpan={2} className="muted">Sin servicios registrados</td></tr>}
              </tbody>
            </table>
            <div className="acciones"><button className="btn btn-ghost" onClick={() => setHistorial(null)}>Cerrar</button></div>
          </div>
        </div>
      )}

      {(editando || creando) && (
        <FormPaciente
          paciente={editando}
          onCerrar={() => { setEditando(null); setCreando(false); }}
          onGuardado={() => { setEditando(null); setCreando(false); void buscar(); }}
        />
      )}
    </div>
  );
}

const MARCAS = ['Adulto mayor', 'Discapacidad', 'Movilidad reducida', 'Embarazo', 'Marcación manual'];

function FormPaciente({ paciente, onCerrar, onGuardado }: {
  paciente: Paciente | null; onCerrar: () => void; onGuardado: () => void;
}) {
  const [f, setF] = useState({
    documento: paciente?.documento ?? '',
    nombres: paciente?.nombres ?? '',
    apellidos: paciente?.apellidos ?? '',
    telefono: paciente?.telefono ?? '',
  });
  const [condiciones, setCondiciones] = useState<string[]>(paciente?.condiciones ?? []);
  const [error, setError] = useState('');

  async function guardar() {
    setError('');
    try {
      if (paciente) {
        // El documento no se edita: es el identificador de deduplicación.
        await api.actualizarPaciente(paciente.id, {
          nombres: f.nombres, apellidos: f.apellidos, telefono: f.telefono, condiciones,
        });
      } else {
        await api.crearPaciente({ ...f, condiciones, origen: 'mostrador' });
      }
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{paciente ? 'Editar paciente' : 'Crear paciente'}</h3>
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>Documento</label>
          {/* El documento es el identificador de deduplicación: no se edita. */}
          <input value={f.documento} disabled={Boolean(paciente)}
                 onChange={(e) => setF({ ...f, documento: e.target.value })} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Nombres</label>
            <input value={f.nombres} onChange={(e) => setF({ ...f, nombres: e.target.value })} />
          </div>
          <div className="field">
            <label>Apellidos</label>
            <input value={f.apellidos} onChange={(e) => setF({ ...f, apellidos: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Teléfono / WhatsApp</label>
          <input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} />
        </div>

        <div className="field">
          <label>Marcas preferenciales (cola de atención)</label>
          <div className="chips-seleccion">
            {MARCAS.map((m) => (
              <button key={m} type="button"
                      className={`chip-sel ${condiciones.includes(m) ? 'activo' : ''}`}
                      onClick={() => setCondiciones(
                        condiciones.includes(m) ? condiciones.filter((c) => c !== m) : [...condiciones, m],
                      )}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar}>Guardar</button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
