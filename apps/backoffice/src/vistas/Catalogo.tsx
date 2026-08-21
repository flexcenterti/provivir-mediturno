import { useEffect, useState } from 'react';
import { api, type PrestadorDetalle, type Servicio } from '../api';

/**
 * Especificación §2.4 · Prestadores y servicios.
 * Duraciones por prestador y tipo (RN-01.4), ventana de control (RN-01.3),
 * grupo de balanceo (RN-02.1) y servicios de cupo múltiple (RN-04.4).
 */
export function Catalogo() {
  const [pestana, setPestana] = useState<'prestadores' | 'servicios'>('prestadores');

  return (
    <div className="vista">
      <header className="vista-cab"><h2>Catálogo</h2></header>
      <div className="tabs" style={{ marginBottom: '1rem' }}>
        <button className={`tab ${pestana === 'prestadores' ? 'activa' : ''}`} onClick={() => setPestana('prestadores')}>
          Prestadores
        </button>
        <button className={`tab ${pestana === 'servicios' ? 'activa' : ''}`} onClick={() => setPestana('servicios')}>
          Servicios
        </button>
      </div>
      {pestana === 'prestadores' ? <Prestadores /> : <Servicios />}
    </div>
  );
}

function Prestadores() {
  const [prestadores, setPrestadores] = useState<PrestadorDetalle[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [editando, setEditando] = useState<PrestadorDetalle | null>(null);
  const [error, setError] = useState('');

  const recargar = () => {
    Promise.all([api.prestadores(), api.servicios()])
      .then(async ([ps, ss]) => {
        setServicios(ss);
        setPrestadores(await Promise.all(ps.map((p) => api.prestador(p.id))));
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(recargar, []);

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <p className="nota">
          El balanceo de carga aplica <strong>solo</strong> a los prestadores marcados como medicina general.
          Los especialistas atienden por fechas y no balancean.
        </p>
        <table className="tabla">
          <thead>
            <tr><th>Prestador</th><th>Especialidad</th><th>Balanceo</th><th>Ventana control</th><th>Duraciones</th><th></th></tr>
          </thead>
          <tbody>
            {prestadores.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}<br /><span className="muted">{p.consultorio ?? 'sin consultorio'}</span></td>
                <td>{p.especialidad}</td>
                <td>{p.grupoBalanceo ? <span className="tag t-teal">Medicina general</span> : <span className="muted">No</span>}</td>
                {/* RN-01.3 · la ventana es por prestador: 7-10 días, algunos hasta un mes */}
                <td>{p.config ? `${p.config.ventanaControlDias} días` : <span className="muted">por defecto</span>}</td>
                <td>
                  {p.servicios.map((s) => (
                    <div key={s.servicioId} className="dur">
                      {s.servicio.nombre} · <strong>{s.duracionMin} min</strong>
                    </div>
                  ))}
                </td>
                <td><button className="btn btn-ghost" onClick={() => setEditando(p)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <FormPrestador
          prestador={editando}
          servicios={servicios}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); recargar(); }}
        />
      )}
    </>
  );
}

function FormPrestador({ prestador, servicios, onCerrar, onGuardado }: {
  prestador: PrestadorDetalle; servicios: Servicio[]; onCerrar: () => void; onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(prestador.nombre);
  const [consultorio, setConsultorio] = useState(prestador.consultorio ?? '');
  const [balanceo, setBalanceo] = useState(prestador.grupoBalanceo);
  const [ventana, setVentana] = useState(prestador.config?.ventanaControlDias ?? 10);
  const [duraciones, setDuraciones] = useState<Record<string, number>>(
    Object.fromEntries(prestador.servicios.map((s) => [s.servicioId, s.duracionMin])),
  );
  const [error, setError] = useState('');

  async function guardar() {
    setError('');
    try {
      await api.actualizarPrestador(prestador.id, {
        nombre, consultorio, grupoBalanceo: balanceo, ventanaControlDias: Number(ventana),
        duraciones: Object.entries(duraciones).map(([servicioId, duracionMin]) => ({ servicioId, duracionMin })),
      });
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const alternar = (id: string, min: number) => {
    const copia = { ...duraciones };
    if (min <= 0) delete copia[id]; else copia[id] = min;
    setDuraciones(copia);
  };

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>{prestador.nombre}</h3>
        {error && <div className="error">{error}</div>}

        <div className="grid-2">
          <div className="field">
            <label>Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="field">
            <label>Consultorio</label>
            <input value={consultorio} onChange={(e) => setConsultorio(e.target.value)} />
          </div>
        </div>

        <label className="p-check">
          <input type="checkbox" checked={balanceo} onChange={(e) => setBalanceo(e.target.checked)} />
          Pertenece al grupo de medicina general (participa del balanceo de carga)
        </label>

        <div className="field">
          <label>Ventana de cita de control (días)</label>
          <input type="number" min={1} max={365} value={ventana}
                 onChange={(e) => setVentana(Number(e.target.value))} />
          <span className="p-ayuda">
            Días máximos entre la consulta origen y el control. Referencia del cliente: 7 a 10 días;
            algunos prestadores manejan hasta un mes.
          </span>
        </div>

        <div className="field">
          <label>Duración por servicio (minutos)</label>
          <span className="p-ayuda">Deja en 0 los servicios que este prestador no atiende.</span>
          <div className="duraciones">
            {servicios.map((s) => (
              <div key={s.id} className="dur-fila">
                <span>{s.nombre}</span>
                <input type="number" min={0} max={480} step={5}
                       value={duraciones[s.id] ?? 0}
                       onChange={(e) => alternar(s.id, Number(e.target.value))} />
              </div>
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

const ETIQUETA_TIPO: Record<string, string> = {
  general: 'Consulta general', control: 'Cita de control',
  procedimiento: 'Procedimiento', examen: 'Examen',
};

function Servicios() {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [editando, setEditando] = useState<Servicio | null>(null);
  const [error, setError] = useState('');

  const recargar = () => { api.servicios().then(setServicios).catch((e: Error) => setError(e.message)); };
  useEffect(recargar, []);

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <table className="tabla">
          <thead>
            <tr><th>Servicio</th><th>Categoría</th><th>Tipo</th><th>Duración</th><th>Cupos</th><th></th></tr>
          </thead>
          <tbody>
            {servicios.map((s) => (
              <tr key={s.id}>
                <td>{s.nombre}</td>
                <td className="muted">{s.categoria}</td>
                <td>{ETIQUETA_TIPO[s.tipo] ?? s.tipo}</td>
                <td>{s.duracionMin} min</td>
                <td>
                  {/* RN-04.4 · algunos exámenes ocupan más de un cupo */}
                  {s.cupos > 1 ? <span className="tag t-blue">{s.cupos} cupos</span> : s.cupos}
                </td>
                <td><button className="btn btn-ghost" onClick={() => setEditando(s)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <FormServicio
          servicio={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); recargar(); }}
        />
      )}
    </>
  );
}

function FormServicio({ servicio, onCerrar, onGuardado }: {
  servicio: Servicio; onCerrar: () => void; onGuardado: () => void;
}) {
  const [f, setF] = useState({
    nombre: servicio.nombre, categoria: servicio.categoria,
    duracionMin: servicio.duracionMin, cupos: servicio.cupos,
  });
  const [error, setError] = useState('');

  async function guardar() {
    setError('');
    try {
      await api.actualizarServicio(servicio.id, {
        ...f, duracionMin: Number(f.duracionMin), cupos: Number(f.cupos),
      });
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{servicio.nombre}</h3>
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>Nombre</label>
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        </div>
        <div className="field">
          <label>Categoría</label>
          <input value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} />
        </div>
        <div className="grid-2">
          <div className="field">
            <label>Duración (min)</label>
            <input type="number" min={5} max={480} step={5} value={f.duracionMin}
                   onChange={(e) => setF({ ...f, duracionMin: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Cupos que ocupa</label>
            <input type="number" min={1} max={8} value={f.cupos}
                   onChange={(e) => setF({ ...f, cupos: Number(e.target.value) })} />
            <span className="p-ayuda">La ecografía Doppler ocupa 2.</span>
          </div>
        </div>

        <p className="nota">El tipo de cita no se cambia: define cómo lo trata el motor de agendamiento.</p>

        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar}>Guardar</button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
