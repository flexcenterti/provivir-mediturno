import { useEffect, useState } from 'react';
import {
  api, type ClaveEmitida, type DefinicionPermiso, type Perfil, type UsuarioAdmin,
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
  const [clave, setClave] = useState<ClaveEmitida | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');

  const cargar = () => {
    void api.usuariosAdmin().then(setUsuarios).catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    cargar();
    void api.perfiles().then(setPerfiles).catch(() => undefined);
  }, []);

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

      {creando && (
        <FormUsuario
          perfiles={perfiles.filter((p) => p.activo)}
          onCerrar={() => setCreando(false)}
          onCreado={(c) => { setCreando(false); setClave(c); cargar(); }}
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

function FormUsuario({ perfiles, onCerrar, onCreado }: {
  perfiles: Perfil[];
  onCerrar: () => void;
  onCreado: (c: ClaveEmitida) => void;
}) {
  const [f, setF] = useState({ nombre: '', email: '', perfilId: perfiles[0]?.id ?? '', rol: 'asistente', prestadorId: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true); setError('');
    try {
      onCreado(await api.crearUsuarioAdmin({
        ...f, prestadorId: f.rol === 'prestador' ? f.prestadorId : undefined,
      }));
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
        <input id="u-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
      </div>
      <div className="field">
        <label htmlFor="u-perfil">Perfil</label>
        <select id="u-perfil" value={f.perfilId} onChange={(e) => setF({ ...f, perfilId: e.target.value })} required>
          {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="u-rol">Tipo de cuenta</label>
        <select id="u-rol" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>
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
          <input id="u-prestador" value={f.prestadorId} onChange={(e) => setF({ ...f, prestadorId: e.target.value })}
                 required placeholder="ao" />
        </div>
      )}
      <div className="acciones">
        <button className="btn btn-primary" type="submit" disabled={guardando}>
          {guardando ? 'Creando…' : 'Crear'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCerrar}>Cancelar</button>
      </div>
    </form>
  );
}
