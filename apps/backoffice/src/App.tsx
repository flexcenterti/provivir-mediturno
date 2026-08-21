import { useEffect, useState, type FormEvent } from 'react';
import { api, token, type UsuarioSesion } from './api';
import { Dashboard } from './vistas/Dashboard';
import { Consolidada } from './vistas/Consolidada';
import { Mostrador } from './vistas/Mostrador';
import { VistaPrestador } from './vistas/Prestador';
import { Bandeja } from './vistas/Bandeja';
import { Pacientes } from './vistas/Pacientes';
import { Catalogo } from './vistas/Catalogo';
import { Agendas } from './vistas/Agendas';
import { Administracion } from './vistas/Administracion';

type Vista =
  | 'dashboard' | 'consolidada' | 'bandeja' | 'mostrador' | 'prestador'
  | 'pacientes' | 'catalogo' | 'agendas' | 'administracion';

/** D1 · sin selector de sede: la capacidad multi-sede vive en el modelo, no en la UI. */
const MENU: Array<{ id: Vista; etiqueta: string; roles: UsuarioSesion['rol'][] }> = [
  { id: 'dashboard', etiqueta: 'Dashboard', roles: ['admin', 'asistente'] },
  { id: 'consolidada', etiqueta: 'Agenda consolidada', roles: ['admin', 'asistente'] },
  { id: 'bandeja', etiqueta: 'Bandeja asistente', roles: ['admin', 'asistente'] },
  { id: 'mostrador', etiqueta: 'Mostrador', roles: ['admin', 'asistente'] },
  { id: 'prestador', etiqueta: 'Mi consulta', roles: ['prestador', 'admin'] },
  { id: 'pacientes', etiqueta: 'Pacientes', roles: ['admin', 'asistente'] },
  { id: 'agendas', etiqueta: 'Agendas', roles: ['admin', 'asistente'] },
  { id: 'catalogo', etiqueta: 'Catálogo', roles: ['admin'] },
  { id: 'administracion', etiqueta: 'Administración', roles: ['admin'] },
];

export function App() {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!token.leer()) { setCargando(false); return; }
    api.yo()
      .then((u) => setUsuario(u as UsuarioSesion))
      .catch(() => token.borrar())
      .finally(() => setCargando(false));
  }, []);

  if (cargando) return <div className="cargando">Cargando…</div>;
  if (!usuario) return <Login onEntrar={setUsuario} />;
  return <Consola usuario={usuario} onSalir={() => { token.borrar(); setUsuario(null); }} />;
}

function Consola({ usuario, onSalir }: { usuario: UsuarioSesion; onSalir: () => void }) {
  const disponibles = MENU.filter((m) => m.roles.includes(usuario.rol));
  const [vista, setVista] = useState<Vista>(disponibles[0]?.id ?? 'dashboard');
  const [pendientes, setPendientes] = useState(0);

  /**
   * RN-08.3 - burbuja roja con el conteo de pendientes junto a "Bandeja asistente".
   * SIN sonido: decision explicita del cliente ("el sonido cansa").
   */
  useEffect(() => {
    if (!['admin', 'asistente'].includes(usuario.rol)) return;
    const consultar = () => api.bandejaConteo().then((r) => setPendientes(r.pendientes)).catch(() => undefined);
    consultar();
    const id = setInterval(consultar, 15_000);
    return () => clearInterval(id);
  }, [usuario.rol]);

  return (
    <div className="consola">
      <aside className="lateral">
        <div className="brand">
          <div className="brand-mark">GP</div>
          <div>
            <strong>Grupo Provivir</strong>
            <span className="sede">CDC Oriente</span>
          </div>
        </div>

        <nav>
          {disponibles.map((m) => (
            <button key={m.id} className={`nav-item ${vista === m.id ? 'activo' : ''}`} onClick={() => setVista(m.id)}>
              {m.etiqueta}
              {m.id === 'bandeja' && pendientes > 0 && <span className="burbuja-conteo">{pendientes}</span>}
            </button>
          ))}
        </nav>

        <div className="usuario">
          <span>{usuario.nombre}</span>
          <span className="muted">{usuario.rol}</span>
          <button className="btn btn-ghost" onClick={onSalir}>Salir</button>
        </div>
      </aside>

      <main className="contenido">
        {vista === 'dashboard' && <Dashboard />}
        {vista === 'consolidada' && <Consolidada />}
        {vista === 'bandeja' && <Bandeja />}
        {vista === 'mostrador' && <Mostrador />}
        {vista === 'pacientes' && <Pacientes />}
        {vista === 'agendas' && <Agendas />}
        {vista === 'catalogo' && <Catalogo />}
        {vista === 'administracion' && <Administracion />}
        {vista === 'prestador' && (
          usuario.prestadorId
            ? <VistaPrestador prestadorId={usuario.prestadorId} />
            : <p className="nota">Este usuario no está asociado a una ficha de prestador.</p>
        )}
      </main>
    </div>
  );
}

function Login({ onEntrar }: { onEntrar: (u: UsuarioSesion) => void }) {
  const [email, setEmail] = useState('admin@provivir.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(''); setEnviando(true);
    try {
      const r = await api.login(email, password);
      token.guardar(r.accessToken);
      onEntrar(r.usuario);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={enviar}>
        <div className="brand">
          <div className="brand-mark">GP</div>
          <h1>Grupo Provivir</h1>
        </div>
        <p className="login-sub">CDC Oriente · Plataforma de agendamiento</p>
        {error && <div className="error" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">Correo</label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
