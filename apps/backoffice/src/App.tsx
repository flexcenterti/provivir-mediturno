import { useState, type FormEvent } from 'react';
import { login, type UsuarioSesion } from './api';

const ETIQUETA_ROL: Record<UsuarioSesion['rol'], string> = {
  admin: 'Administración',
  asistente: 'Asistente',
  prestador: 'Prestador',
  pantalla: 'Pantalla de sala',
};

export function App() {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [email, setEmail] = useState('admin@provivir.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const r = await login(email, password);
      sessionStorage.setItem('accessToken', r.accessToken);
      setUsuario(r.usuario);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error inesperado');
    } finally {
      setCargando(false);
    }
  }

  if (usuario) {
    return (
      <div className="panel">
        <h1>Grupo Provivir · CDC Oriente</h1>
        <div className="card">
          <p>
            Sesión iniciada como <strong>{usuario.nombre}</strong>
          </p>
          <p style={{ marginTop: '.6rem' }}>
            Rol: <span className="chip">{ETIQUETA_ROL[usuario.rol]}</span>
          </p>
          <p style={{ marginTop: '1rem', color: 'var(--muted)', fontSize: '.86rem' }}>
            Fase 0 · fundaciones. El backoffice se construye en la Fase 3.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={enviar}>
        <div className="brand">
          <div className="brand-mark">GP</div>
          <h1>Grupo Provivir</h1>
        </div>
        <p className="login-sub">CDC Oriente · Plataforma de agendamiento</p>

        {error && <div className="error">{error}</div>}

        <div className="field">
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={cargando}>
          {cargando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
