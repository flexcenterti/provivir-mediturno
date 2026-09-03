import { useEffect, useState, type FormEvent } from 'react';
import { api, sesion, token, type UsuarioSesion } from './api';
import { Dashboard } from './vistas/Dashboard';
import { Consolidada } from './vistas/Consolidada';
import { Mostrador } from './vistas/Mostrador';
import { VistaPrestador } from './vistas/Prestador';
import { Bandeja } from './vistas/Bandeja';
import { Pacientes } from './vistas/Pacientes';
import { Catalogo } from './vistas/Catalogo';
import { Agendas } from './vistas/Agendas';
import { Administracion } from './vistas/Administracion';
import { Conocimiento } from './vistas/Conocimiento';
import { Metricas } from './vistas/Metricas';
import { PortalWeb } from './vistas/PortalWeb';
import { Prioridad } from './vistas/Prioridad';

type Vista =
  | 'dashboard' | 'consolidada' | 'bandeja' | 'mostrador' | 'prestador'
  | 'pacientes' | 'prestadores' | 'servicios' | 'agendas' | 'carga'
  | 'conocimiento' | 'metricas' | 'pantallas' | 'prioridad' | 'portalweb'
  | 'auditoria' | 'administracion';

interface Entrada {
  id: Vista;
  /** Lo que dice el botón del menú. */
  etiqueta: string;
  /** Decorativo: va en un span `aria-hidden` para no ensuciar el nombre accesible. */
  icono: string;
  /** Encabezado de la barra superior, con los textos del prototipo. */
  titulo: string;
  subtitulo: string;
  /**
   * El permiso que exige, no el rol. La plataforma deja crear perfiles a medida
   * —«un coordinador que ve métricas y nada más», dice `permisos.ts`— y filtrar
   * por rol hacía que esos perfiles no se reflejaran en el menú.
   */
  permiso: string;
}

/**
 * D1 · sin selector de sede: la capacidad multi-sede vive en el modelo, no en la UI.
 *
 * Las secciones y los iconos son los de la especificación visual (`docs/index_v2.html`).
 * Cuatro entradas abren una vista que ya existía en una pestaña —Prestadores y
 * Servicios dentro de Catálogo; Carga masiva, Auditoría y Pantallas dentro de
 * Administración—: se promueven al menú **sin quitar las pestañas**, así que hay dos
 * caminos hacia la misma pantalla y ninguno se rompe.
 */
const MENU: Array<{ seccion: string; items: Entrada[] }> = [
  {
    seccion: 'Operación',
    items: [
      { id: 'dashboard', etiqueta: 'Dashboard', icono: '📊', permiso: 'metricas.ver',
        titulo: 'Dashboard operativo', subtitulo: 'Resumen de la operación · CPP Principal' },
      { id: 'consolidada', etiqueta: 'Agenda consolidada', icono: '🗓️', permiso: 'citas.gestionar',
        titulo: 'Agenda consolidada', subtitulo: 'Día · semana · mes · citas inmediatas y futuras' },
      { id: 'bandeja', etiqueta: 'Bandeja asistente', icono: '📥', permiso: 'bandeja.operar',
        titulo: 'Bandeja de la asistente', subtitulo: 'Conversaciones escaladas por la IA · prioridad y tiempo de espera' },
      { id: 'mostrador', etiqueta: 'Mostrador', icono: '🛎️', permiso: 'mostrador.operar',
        titulo: 'Atención en mostrador', subtitulo: 'Canal principal de llegada · pago en recepción · ticket' },
      { id: 'prestador', etiqueta: 'Mi consulta', icono: '🩺', permiso: 'turnos.atender',
        titulo: 'Vista del prestador', subtitulo: 'Cola de espera, tipo de servicio y llamado de turnos' },
    ],
  },
  {
    seccion: 'Gestión',
    items: [
      { id: 'pacientes', etiqueta: 'Pacientes', icono: '👥', permiso: 'pacientes.ver',
        titulo: 'Gestión de pacientes', subtitulo: 'Búsqueda, alta y historial de servicios' },
      { id: 'prestadores', etiqueta: 'Prestadores', icono: '🧑‍⚕️', permiso: 'catalogo.editar',
        titulo: 'Prestadores', subtitulo: 'Duraciones por tipo de cita · balanceo de medicina general' },
      { id: 'servicios', etiqueta: 'Servicios y exámenes', icono: '🧾', permiso: 'catalogo.editar',
        titulo: 'Servicios y exámenes', subtitulo: 'Tipos de cita, procedimientos y servicios de doble cupo' },
      { id: 'agendas', etiqueta: 'Gestión de agendas', icono: '⏱️', permiso: 'agenda.editar',
        titulo: 'Gestión de agendas', subtitulo: 'Semanal · por calendario · programación mensual (solo administración)' },
      { id: 'carga', etiqueta: 'Carga masiva', icono: '📤', permiso: 'carga.ejecutar',
        titulo: 'Carga masiva de pacientes', subtitulo: 'Plantilla del cliente · filtro último año · historial de servicios' },
    ],
  },
  {
    seccion: 'Configuración',
    items: [
      { id: 'conocimiento', etiqueta: 'Base de conocimiento', icono: '🧠', permiso: 'conocimiento.ver',
        titulo: 'Base de conocimiento del bot', subtitulo: 'Lo que la IA responde antes de escalar · contenido aprobado y trazable (RN-13)' },
      { id: 'metricas', etiqueta: 'Métricas', icono: '📈', permiso: 'metricas.ver',
        titulo: 'Métricas operativas', subtitulo: 'Indicadores del MVP · tablero definitivo pendiente del cliente' },
      { id: 'pantallas', etiqueta: 'Pantallas de sala', icono: '🖥️', permiso: 'pantallas.ver',
        titulo: 'Pantallas de sala', subtitulo: 'Turnos + frame de noticias y videos institucionales (YouTube)' },
      { id: 'prioridad', etiqueta: 'Reglas de prioridad', icono: '⚖️', permiso: 'configuracion.editar',
        titulo: 'Reglas de prioridad', subtitulo: 'Parámetros de llegada · criterios de casos pendientes del cliente' },
      { id: 'portalweb', etiqueta: 'Autoagendamiento web', icono: '🌐', permiso: 'configuracion.editar',
        titulo: 'Autoagendamiento web', subtitulo: 'Enlace público y QR para grupoprovivir.com y la sede' },
      { id: 'auditoria', etiqueta: 'Auditoría', icono: '🔍', permiso: 'auditoria.ver',
        titulo: 'Auditoría', subtitulo: 'Registro append-only · quién hizo qué y cuándo' },
      { id: 'administracion', etiqueta: 'Administración', icono: '⚙️', permiso: 'usuarios.gestionar',
        titulo: 'Administración', subtitulo: 'Perfiles y usuarios · kiosko · reglas del sistema' },
    ],
  },
];

export function App() {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [cargando, setCargando] = useState(true);

  // Si el refresco tampoco sirve, se vuelve al login en vez de dejar la vista con
  // un error y los datos a medias.
  useEffect(() => sesion.alCaer(() => setUsuario(null)), []);

  useEffect(() => {
    if (!token.leer()) { setCargando(false); return; }
    // Al recargar la pestaña el token de acceso puede estar vencido: `pedir` lo
    // renueva con el de refresco y la sesión sigue como estaba.
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
  // Una sección sin entradas visibles no pinta su rótulo.
  const secciones = MENU
    .map((s) => ({ ...s, items: s.items.filter((i) => usuario.permisos.includes(i.permiso)) }))
    .filter((s) => s.items.length > 0);
  const entradas = secciones.flatMap((s) => s.items);

  const [vista, setVista] = useState<Vista>(entradas[0]?.id ?? 'dashboard');
  const [pendientes, setPendientes] = useState(0);
  const activa = entradas.find((e) => e.id === vista) ?? entradas[0];

  /**
   * RN-08.3 - burbuja roja con el conteo de pendientes junto a "Bandeja asistente".
   * SIN sonido: decision explicita del cliente ("el sonido cansa").
   */
  useEffect(() => {
    if (!usuario.permisos.includes('bandeja.operar')) return;
    const consultar = () => api.bandejaConteo().then((r) => setPendientes(r.pendientes)).catch(() => undefined);
    consultar();
    const id = setInterval(consultar, 15_000);
    return () => clearInterval(id);
  }, [usuario.permisos]);

  return (
    <div className="consola">
      <aside className="lateral">
        <div className="brand">
          <div className="brand-mark">CPP</div>
          <div>
            <strong>Centro de Profesionales & Provivir</strong>
            <span className="sede">CPP Principal</span>
          </div>
        </div>

        <nav>
          {secciones.map((s) => (
            <div key={s.seccion}>
              <div className="nav-sec">{s.seccion}</div>
              {s.items.map((m) => (
                <button
                  key={m.id}
                  className={`nav-item ${vista === m.id ? 'activo' : ''}`}
                  onClick={() => setVista(m.id)}
                >
                  {/* Decorativo: fuera del nombre accesible, que sigue siendo la etiqueta sola. */}
                  <span className="ic" aria-hidden="true">{m.icono}</span>
                  {m.etiqueta}
                  {m.id === 'bandeja' && pendientes > 0 && <span className="burbuja-conteo">{pendientes}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="foot">
          <button className="nav-item" onClick={onSalir}>
            <span className="ic" aria-hidden="true">🚪</span>Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="contenido">
        <div className="topbar">
          <div>
            <h2>{activa?.titulo ?? 'Provivir'}</h2>
            <div className="sub">{activa?.subtitulo ?? ''}</div>
          </div>
          <div className="spacer" />
          <span className="tag t-teal">📍 CPP Principal</span>
          <div className="user-pill">
            <div className="avatar">{usuario.nombre.slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="nm">{usuario.nombre}</div>
              <div className="rl">{usuario.rol}</div>
            </div>
          </div>
        </div>

        {vista === 'dashboard' && <Dashboard />}
        {vista === 'consolidada' && <Consolidada />}
        {vista === 'bandeja' && <Bandeja />}
        {vista === 'mostrador' && <Mostrador />}
        {vista === 'pacientes' && <Pacientes />}
        {vista === 'agendas' && <Agendas />}
        {vista === 'prestadores' && <Catalogo inicial="prestadores" />}
        {vista === 'servicios' && <Catalogo inicial="servicios" />}
        {vista === 'conocimiento' && <Conocimiento usuario={usuario} onNavegar={setVista} />}
        {vista === 'metricas' && <Metricas />}
        {vista === 'prioridad' && <Prioridad />}
        {vista === 'portalweb' && <PortalWeb />}
        {vista === 'carga' && <Administracion inicial="carga" />}
        {vista === 'auditoria' && <Administracion inicial="auditoria" />}
        {vista === 'pantallas' && <Administracion inicial="pantallas" />}
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
      token.guardar(r.accessToken, r.refreshToken);
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
          <div className="brand-mark">CPP</div>
          <h1>Centro de Profesionales & Provivir</h1>
        </div>
        <p className="login-sub">CPP Principal · Plataforma de agendamiento</p>
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
