import { useEffect, useState } from 'react';
import {
  api, type ClaveEmitida, type DefinicionPermiso, type Perfil, type Prestador, type UsuarioAdmin,
} from '../api';

/**
 * Perfiles de acceso y usuarios.
 *
 * El orden de la pantalla no es casual: primero se define un perfil —qué puede ver
 * y qué no— y solo después se crea a la persona y se le asigna uno. Crear usuarios
 * sueltos con permisos ad hoc es cómodo el primer día y un problema el resto.
 */
export function Acceso() {
  const [pestana, setPestana] = useState<'perfiles' | 'usuarios'>('perfiles');

  return (
    <>
      <div className="tabs" style={{ marginBottom: '1rem' }}>
        <button className={`tab ${pestana === 'perfiles' ? 'activa' : ''}`} onClick={() => setPestana('perfiles')}>
          1 · Perfiles
        </button>
        <button className={`tab ${pestana === 'usuarios' ? 'activa' : ''}`} onClick={() => setPestana('usuarios')}>
          2 · Usuarios
        </button>
      </div>
      {pestana === 'perfiles' ? <Perfiles /> : <Usuarios />}
    </>
  );
}

/** La contraseña se muestra una sola vez: no existe forma de recuperarla después. */
function ClaveNueva({ clave, onCerrar }: { clave: ClaveEmitida; onCerrar: () => void }) {
  const [copiada, setCopiada] = useState(false);

  return (
    <div className="aviso-clave" role="alert">
      <strong>Contraseña de {clave.email}</strong>
      <code className="clave">{clave.password}</code>
      <p>
        No se vuelve a mostrar: en la base solo queda su huella. Entrégasela por un medio
        seguro y pídele que la cambie.
      </p>
      <div className="acciones">
        <button
          className="btn btn-primary"
          onClick={() => { void navigator.clipboard?.writeText(clave.password); setCopiada(true); }}
        >
          {copiada ? 'Copiada' : 'Copiar'}
        </button>
        <button className="btn btn-ghost" onClick={onCerrar}>Ya la guardé</button>
      </div>
    </div>
  );
}

function Perfiles() {
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [catalogo, setCatalogo] = useState<DefinicionPermiso[]>([]);
  const [editando, setEditando] = useState<Perfil | 'nuevo' | null>(null);
  const [error, setError] = useState('');

  const cargar = () => {
    void api.perfiles().then(setPerfiles).catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    cargar();
    void api.permisos().then(setCatalogo).catch(() => undefined);
  }, []);

  async function eliminar(p: Perfil) {
    if (!confirm(`¿Eliminar el perfil "${p.nombre}"?`)) return;
    setError('');
    try {
      await api.eliminarPerfil(p.id);
      cargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (editando) {
    return (
      <FormPerfil
        perfil={editando === 'nuevo' ? null : editando}
        catalogo={catalogo}
        onCerrar={() => setEditando(null)}
        onGuardado={() => { setEditando(null); cargar(); }}
      />
    );
  }

  return (
    <section className="panel">
      <div className="panel-cab">
        <h3>Perfiles de acceso</h3>
        <button className="btn btn-primary" onClick={() => setEditando('nuevo')}>Nuevo perfil</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      <table className="tabla">
        <thead>
          <tr><th>Perfil</th><th>Qué habilita</th><th>Permisos</th><th>Usuarios</th><th></th></tr>
        </thead>
        <tbody>
          {perfiles.map((p) => (
            <tr key={p.id} className={p.activo ? '' : 'inactiva'}>
              <td>
                <strong>{p.nombre}</strong>
                {p.sistema && <span className="etiqueta"> base</span>}
                {!p.activo && <span className="etiqueta"> desactivado</span>}
              </td>
              <td className="tenue">{p.descripcion}</td>
              <td>{p.permisos.length}</td>
              <td>{p._count.usuarios}</td>
              <td className="acciones">
                <button className="btn btn-ghost" onClick={() => setEditando(p)}>Editar</button>
                {/* Los base no se borran: son la red que impide quedarse sin acceso. */}
                {!p.sistema && (
                  <button className="btn btn-ghost" onClick={() => void eliminar(p)}>Eliminar</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!perfiles.length && <p className="tenue">Sin perfiles todavía.</p>}
    </section>
  );
}

function FormPerfil({ perfil, catalogo, onCerrar, onGuardado }: {
  perfil: Perfil | null;
  catalogo: DefinicionPermiso[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(perfil?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(perfil?.descripcion ?? '');
  const [permisos, setPermisos] = useState<string[]>(perfil?.permisos ?? []);
  const [activo, setActivo] = useState(perfil?.activo ?? true);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const areas = [...new Set(catalogo.map((p) => p.area))];
  const alternar = (clave: string) =>
    setPermisos((p) => (p.includes(clave) ? p.filter((x) => x !== clave) : [...p, clave]));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError('');
    try {
      if (perfil) await api.actualizarPerfil(perfil.id, { nombre, descripcion, permisos, activo });
      else await api.crearPerfil({ nombre, descripcion, permisos });
      onGuardado();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="panel" onSubmit={guardar}>
      <div className="panel-cab">
        <h3>{perfil ? `Editar «${perfil.nombre}»` : 'Nuevo perfil'}</h3>
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      <div className="field">
        <label htmlFor="p-nombre">Nombre</label>
        <input id="p-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
               required minLength={3} placeholder="Coordinador de facturación" />
      </div>
      <div className="field">
        <label htmlFor="p-desc">Para qué sirve</label>
        <input id="p-desc" value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
               placeholder="Lo lee quien asigne el perfil, no el sistema" />
      </div>

      <p className="tenue">
        Marca lo que este perfil puede hacer. Lo que no esté marcado queda bloqueado, y
        el cambio aplica en la siguiente petición de quien lo tenga.
      </p>

      {areas.map((area) => (
        <fieldset key={area} className="permisos-area">
          <legend>{area}</legend>
          {catalogo.filter((p) => p.area === area).map((p) => (
            <label key={p.clave} className="permiso">
              <input type="checkbox" checked={permisos.includes(p.clave)} onChange={() => alternar(p.clave)} />
              <span>
                <strong>{p.etiqueta}</strong>
                <em>{p.descripcion}</em>
              </span>
            </label>
          ))}
        </fieldset>
      ))}

      {perfil && (
        <label className="permiso">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          <span><strong>Perfil activo</strong><em>Desactivarlo corta el acceso de todos sus usuarios a la vez.</em></span>
        </label>
      )}

      <div className="acciones">
        <button className="btn btn-primary" type="submit" disabled={guardando || permisos.length === 0}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCerrar}>Cancelar</button>
      </div>
      {permisos.length === 0 && <p className="tenue">Un perfil sin permisos no serviría de nada.</p>}
    </form>
  );
}

function Usuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [clave, setClave] = useState<ClaveEmitida | null>(null);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null);
  const [error, setError] = useState('');

  const cargar = () => {
    void api.usuariosAdmin().then(setUsuarios).catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    cargar();
    void api.perfiles().then(setPerfiles).catch(() => undefined);
    // Con los desactivados: si no, un usuario atado a una ficha ya retirada no
    // encontraría su opción y perdería el vínculo al guardar.
    void api.prestadores(true).then(setPrestadores).catch(() => undefined);
  }, []);

  /** Qué ficha tiene ya cuenta, y de quién. `Usuario.prestadorId` es único. */
  const ocupadas = new Map(
    usuarios.filter((u) => u.prestadorId).map((u) => [u.prestadorId!, u.email]),
  );
  const nombreDeFicha = (id: string) => prestadores.find((p) => p.id === id)?.nombre ?? id;

  async function accion(fn: () => Promise<unknown>) {
    setError('');
    try { await fn(); cargar(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <section className="panel">
      <div className="panel-cab">
        <h3>Usuarios</h3>
        <button className="btn btn-primary" onClick={() => setCreando(true)} disabled={!perfiles.length}>
          Nuevo usuario
        </button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      {clave && <ClaveNueva clave={clave} onCerrar={() => setClave(null)} />}
      {!perfiles.length && <p className="tenue">Crea primero un perfil: todo usuario necesita uno.</p>}

      {(creando || editando) && (
        <FormUsuario
          perfiles={perfiles.filter((p) => p.activo)}
          prestadores={prestadores}
          ocupadas={ocupadas}
          usuario={editando ?? undefined}
          onCerrar={() => { setCreando(false); setEditando(null); }}
          onCreado={(c) => { setCreando(false); setClave(c); cargar(); }}
          onGuardado={() => { setEditando(null); cargar(); }}
        />
      )}

      <table className="tabla">
        <thead>
          <tr><th>Persona</th><th>Perfil</th><th>Último acceso</th><th></th></tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} className={u.activo ? '' : 'inactiva'}>
              <td>
                <strong>{u.nombre}</strong><br />
                <span className="tenue">{u.email}</span>
                {!u.activo && <span className="etiqueta"> desactivado</span>}
                {/* RN-06.2 · el vínculo con la ficha, visible: es lo que decide si la
                    persona ve su cola en «Mi consulta». */}
                {u.rol === 'prestador' && (
                  <>
                    <br />
                    <span className="tenue">
                      {u.prestadorId
                        ? `🩺 ${nombreDeFicha(u.prestadorId)}`
                        : '⚠️ médico sin ficha asociada'}
                    </span>
                  </>
                )}
              </td>
              <td>
                <select
                  value={u.perfil?.id ?? ''}
                  onChange={(e) => void accion(() => api.actualizarUsuarioAdmin(u.id, { perfilId: e.target.value }))}
                >
                  {!u.perfil && <option value="">— sin perfil —</option>}
                  {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </td>
              <td className="tenue">
                {u.ultimoAcceso ? new Date(u.ultimoAcceso).toLocaleString('es-CO') : 'nunca entró'}
              </td>
              <td className="acciones">
                <button className="btn btn-ghost" onClick={() => setEditando(u)}>Editar</button>
                <button className="btn btn-ghost"
                        onClick={() => void accion(async () => setClave(await api.reiniciarClave(u.id)))}>
                  Nueva contraseña
                </button>
                <button className="btn btn-ghost"
                        onClick={() => void accion(() => api.actualizarUsuarioAdmin(u.id, { activo: !u.activo }))}>
                  {u.activo ? 'Desactivar' : 'Activar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * Alta y edición en el mismo formulario.
 *
 * Un solo Guardar y un solo PATCH, y no dos desplegables sueltos en la tabla, porque
 * pasar a Médico exige ficha **en la misma petición** (RN-06.2): con dos guardados
 * independientes el paso intermedio —médico sin ficha— está prohibido y no habría
 * forma de llegar al estado final.
 */
function FormUsuario({ perfiles, prestadores, ocupadas, usuario, onCerrar, onCreado, onGuardado }: {
  perfiles: Perfil[];
  prestadores: Prestador[];
  /** Ficha → correo de la cuenta que ya la tiene. `prestadorId` es único. */
  ocupadas: Map<string, string>;
  usuario?: UsuarioAdmin;
  onCerrar: () => void;
  onCreado: (c: ClaveEmitida) => void;
  onGuardado: () => void;
}) {
  const editando = usuario !== undefined;
  const [f, setF] = useState({
    nombre: usuario?.nombre ?? '',
    email: usuario?.email ?? '',
    perfilId: usuario?.perfil?.id ?? perfiles[0]?.id ?? '',
    rol: usuario?.rol ?? 'asistente',
    prestadorId: usuario?.prestadorId ?? '',
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError('');
    try {
      if (editando) {
        await api.actualizarUsuarioAdmin(usuario.id, {
          nombre: f.nombre, perfilId: f.perfilId, rol: f.rol,
          // `null` suelta la ficha; el backend lo hace solo al dejar de ser médico,
          // pero mandarlo explícito evita depender de ese efecto.
          prestadorId: f.rol === 'prestador' ? f.prestadorId : null,
        });
        onGuardado();
      } else {
        onCreado(await api.crearUsuarioAdmin({
          ...f, prestadorId: f.rol === 'prestador' ? f.prestadorId : undefined,
        }));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="panel-interno" onSubmit={enviar}>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="field">
        <label htmlFor="u-nombre">Nombre</label>
        <input id="u-nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required />
      </div>
      <div className="field">
        <label htmlFor="u-email">Correo</label>
        {/* Al editar es de solo lectura: el DTO no lo admite, y cambiar el correo de
            una cuenta es otra conversación. */}
        <input id="u-email" type="email" value={f.email} required
               readOnly={editando} disabled={editando}
               onChange={(e) => setF({ ...f, email: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="u-perfil">Perfil</label>
        <select id="u-perfil" value={f.perfilId} onChange={(e) => setF({ ...f, perfilId: e.target.value })} required>
          {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="u-rol">Tipo de cuenta</label>
        <select id="u-rol" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value as UsuarioAdmin['rol'] })}>
          <option value="asistente">Personal administrativo</option>
          <option value="admin">Administración</option>
          <option value="prestador">Médico</option>
          <option value="pantalla">Pantalla de sala</option>
        </select>
        <span className="p-ayuda">
          No decide los permisos —eso es el perfil—, solo si la cuenta se ata a una ficha médica.
        </span>
      </div>
      {/* RN-06.2 · un usuario médico se ata a su ficha para ver solo su agenda. */}
      {f.rol === 'prestador' && (
        <div className="field">
          <label htmlFor="u-prestador">Ficha de prestador</label>
          <select id="u-prestador" value={f.prestadorId} required
                  onChange={(e) => setF({ ...f, prestadorId: e.target.value })}>
            <option value="">Seleccione…</option>
            {prestadores.map((p) => {
              // Las ya atadas a otra cuenta se muestran y se bloquean: ocultarlas
              // haría pensar que la ficha no existe, y dejarlas elegibles convertiría
              // el desplegable en una ruleta contra el índice único.
              const ocupadaPor = ocupadas.get(p.id);
              const ajena = ocupadaPor !== undefined && p.id !== usuario?.prestadorId;
              return (
                <option key={p.id} value={p.id} disabled={ajena}>
                  {p.nombre}{ajena ? ` · ya tiene cuenta (${ocupadaPor})` : ''}
                </option>
              );
            })}
          </select>
        </div>
      )}
      <div className="acciones">
        <button className="btn btn-primary" type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : editando ? 'Guardar' : 'Crear'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCerrar}>Cancelar</button>
      </div>
    </form>
  );
}
