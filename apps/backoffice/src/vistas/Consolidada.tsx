import { useEffect, useState } from 'react';
import { api, hoyIso, type Cita, type Cupo, type Paciente, type Prestador, type Servicio } from '../api';
import { TablaCitas } from './Dashboard';

type Vista = 'dia' | 'semana' | 'mes';

/** Especificación §2.8 · Agenda consolidada con vistas día/semana/mes. */
export function Consolidada() {
  const [vista, setVista] = useState<Vista>('dia');
  const [ancla, setAncla] = useState(hoyIso());
  const [prestadorId, setPrestadorId] = useState('');
  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [citas, setCitas] = useState<Cita[]>([]);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');

  const { desde, hasta } = rango(vista, ancla);

  useEffect(() => { api.prestadores().then(setPrestadores).catch(() => undefined); }, []);

  const recargar = () => {
    api.consolidada(desde, hasta, prestadorId || undefined)
      .then(setCitas)
      .catch((e) => setError(e.message));
  };
  useEffect(recargar, [desde, hasta, prestadorId]);

  return (
    <div className="vista">
      <header className="vista-cab">
        <h2>Agenda consolidada</h2>
        <button className="btn btn-primary" onClick={() => setCreando(true)}>Crear cita</button>
      </header>

      <div className="controles">
        <div className="tabs">
          {(['dia', 'semana', 'mes'] as Vista[]).map((v) => (
            <button key={v} className={`tab ${vista === v ? 'activa' : ''}`} onClick={() => setVista(v)}>
              {{ dia: 'Día', semana: 'Semana', mes: 'Mes' }[v]}
            </button>
          ))}
        </div>
        <input type="date" value={ancla} onChange={(e) => setAncla(e.target.value)} />
        {/* §2.8 · selector en lugar de apilar todas las columnas */}
        <select value={prestadorId} onChange={(e) => setPrestadorId(e.target.value)}>
          <option value="">Todos los prestadores</option>
          {prestadores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <span className="muted">{desde} → {hasta} · {citas.length} cita(s)</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card"><TablaCitas citas={citas} /></div>

      {creando && <ModalCrearCita onCerrar={() => setCreando(false)} onCreada={() => { setCreando(false); recargar(); }} />}
    </div>
  );
}

function rango(vista: Vista, ancla: string): { desde: string; hasta: string } {
  const d = new Date(`${ancla}T00:00:00Z`);
  if (vista === 'dia') return { desde: ancla, hasta: ancla };

  if (vista === 'semana') {
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    const lunes = new Date(d); lunes.setUTCDate(d.getUTCDate() - (dow - 1));
    const domingo = new Date(lunes); domingo.setUTCDate(lunes.getUTCDate() + 6);
    return { desde: iso(lunes), hasta: iso(domingo) };
  }

  const primero = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { desde: iso(primero), hasta: iso(ultimo) };
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * §2.8 · Crear cita con tipo de cita y "Crear paciente" embebido,
 * para no salir del flujo. Los cupos los ofrece el motor: la UI no calcula reglas.
 */
function ModalCrearCita({ onCerrar, onCreada }: { onCerrar: () => void; onCreada: () => void }) {
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [servicioId, setServicioId] = useState('');
  const [fecha, setFecha] = useState(hoyIso());
  const [q, setQ] = useState('');
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [paciente, setPaciente] = useState<Paciente | null>(null);
  const [cupos, setCupos] = useState<Cupo[]>([]);
  const [error, setError] = useState('');
  const [nuevoPaciente, setNuevoPaciente] = useState(false);
  const [alternativas, setAlternativas] = useState<Cupo[]>([]);

  useEffect(() => { api.servicios().then(setServicios).catch(() => undefined); }, []);

  useEffect(() => {
    if (!servicioId || !fecha) { setCupos([]); return; }
    api.cupos({ servicioId, fecha, limite: '12' })
      .then(setCupos)
      .catch((e) => setError(e.message));
  }, [servicioId, fecha]);

  async function buscarPaciente() {
    if (q.trim().length < 3) return;
    const r = await api.pacientes(q);
    setPacientes(r.datos);
  }

  async function agendar(cupo: Cupo) {
    if (!paciente) { setError('Seleccione el paciente'); return; }
    setError(''); setAlternativas([]);
    try {
      const r = await api.crearCita({
        pacienteId: paciente.id, servicioId, fecha, hora: cupo.hora,
        prestadorId: cupo.prestadorId, origen: 'asistente',
      });
      if (r.creada) return onCreada();
      // El cupo se ocupó entre la oferta y la confirmación: el motor devuelve alternativas.
      setError(r.motivo ?? 'El cupo ya no está disponible');
      setAlternativas(r.alternativas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const servicio = servicios.find((s) => s.id === servicioId);

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>Crear cita</h3>
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>Paciente</label>
          {paciente ? (
            <div className="seleccionado">
              {paciente.apellidos}, {paciente.nombres} · {paciente.documento}
              <button className="btn btn-ghost" onClick={() => setPaciente(null)}>Cambiar</button>
            </div>
          ) : (
            <>
              <div className="buscador">
                <input placeholder="Documento o nombre…" value={q}
                       onChange={(e) => setQ(e.target.value)}
                       onKeyDown={(e) => e.key === 'Enter' && buscarPaciente()} />
                <button className="btn btn-ghost" onClick={buscarPaciente}>Buscar</button>
                <button className="btn btn-ghost" onClick={() => setNuevoPaciente(true)}>Crear paciente</button>
              </div>
              {pacientes.length > 0 && (
                <ul className="lista">
                  {pacientes.slice(0, 6).map((p) => (
                    <li key={p.id}><button onClick={() => { setPaciente(p); setPacientes([]); }}>
                      {p.apellidos}, {p.nombres} · {p.documento}
                    </button></li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Servicio y tipo de cita</label>
            <select value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
              <option value="">Seleccione…</option>
              {servicios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre} · {s.duracionMin} min{s.cupos > 1 ? ` · ${s.cupos} cupos` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
        </div>

        {servicio?.tipo === 'control' && (
          <p className="nota">
            Las citas de control exigen la consulta origen y deben caer dentro de la
            ventana del prestador. Se agendan desde la ficha de la consulta original.
          </p>
        )}

        <div className="field">
          <label>Cupos disponibles</label>
          <div className="cupos">
            {(alternativas.length ? alternativas : cupos).map((c, i) => (
              <button key={`${c.prestadorId}-${c.hora}-${i}`} className="cupo" onClick={() => agendar(c)}>
                <strong>{c.hora}</strong>
                <span>{c.prestadorNombre}</span>
                <span className="muted">{c.duracionMin} min</span>
              </button>
            ))}
            {cupos.length === 0 && !alternativas.length && (
              <p className="muted">Seleccione servicio y fecha para ver los cupos que ofrece el motor.</p>
            )}
          </div>
        </div>

        <div className="acciones"><button className="btn btn-ghost" onClick={onCerrar}>Cerrar</button></div>

        {nuevoPaciente && (
          <ModalCrearPaciente
            onCerrar={() => setNuevoPaciente(false)}
            onCreado={(p) => { setPaciente(p); setNuevoPaciente(false); }}
          />
        )}
      </div>
    </div>
  );
}

function ModalCrearPaciente({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: (p: Paciente) => void }) {
  const [form, setForm] = useState({ documento: '', nombres: '', apellidos: '', telefono: '' });
  const [error, setError] = useState('');

  async function guardar() {
    try {
      onCreado(await api.crearPaciente({ ...form, origen: 'mostrador' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const campo = (k: keyof typeof form, etiqueta: string) => (
    <div className="field">
      <label>{etiqueta}</label>
      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Crear paciente</h3>
        {error && <div className="error">{error}</div>}
        {campo('documento', 'Documento')}
        {campo('nombres', 'Nombres')}
        {campo('apellidos', 'Apellidos')}
        {campo('telefono', 'Teléfono / WhatsApp')}
        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar}>Guardar y seleccionar</button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
