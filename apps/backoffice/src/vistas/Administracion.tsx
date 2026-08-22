import { useEffect, useRef, useState } from 'react';
import {
  api, token, type EstadoKiosko, type Pantalla, type RegistroAuditoria,
  type Servicio, type TrabajoCarga,
} from '../api';
import { Acceso } from './Acceso';

type Seccion = 'acceso' | 'carga' | 'auditoria' | 'pantallas' | 'kiosko' | 'configuracion';

/**
 * En producción las tres apps comparten dominio y la TV vive en /tv.
 * En desarrollo cada una corre en su puerto, así que se apunta al de la TV.
 */
const URL_PANTALLAS = import.meta.env.DEV ? 'http://localhost:5175/' : '/tv/';

const SECCIONES: Array<{ id: Seccion; etiqueta: string }> = [
  { id: 'acceso', etiqueta: 'Perfiles y usuarios' },
  { id: 'carga', etiqueta: 'Carga masiva' },
  { id: 'auditoria', etiqueta: 'Auditoría' },
  { id: 'pantallas', etiqueta: 'Pantallas' },
  { id: 'kiosko', etiqueta: 'Kiosko' },
  { id: 'configuracion', etiqueta: 'Reglas' },
];

export function Administracion() {
  const [seccion, setSeccion] = useState<Seccion>('acceso');

  return (
    <div className="vista">
      <header className="vista-cab"><h2>Administración</h2></header>
      <div className="tabs" style={{ marginBottom: '1rem' }}>
        {SECCIONES.map((s) => (
          <button key={s.id} className={`tab ${seccion === s.id ? 'activa' : ''}`} onClick={() => setSeccion(s.id)}>
            {s.etiqueta}
          </button>
        ))}
      </div>

      {seccion === 'acceso' && <Acceso />}
      {seccion === 'carga' && <CargaMasiva />}
      {seccion === 'auditoria' && <Auditoria />}
      {seccion === 'pantallas' && <Pantallas />}
      {seccion === 'kiosko' && <Kiosko />}
      {seccion === 'configuracion' && <Configuracion />}
    </div>
  );
}

/** Especificación §2.2 · Carga masiva de pacientes y contactos (RN-12, RN-09.5). */
function CargaMasiva() {
  const [trabajos, setTrabajos] = useState<TrabajoCarga[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [filtrar, setFiltrar] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const inputPacientes = useRef<HTMLInputElement>(null);
  const inputContactos = useRef<HTMLInputElement>(null);

  const recargar = () => { api.cargas().then(setTrabajos).catch(() => undefined); };

  useEffect(() => {
    recargar();
    // Una carga de 200.000 registros tarda minutos: el avance se refresca solo.
    const id = setInterval(recargar, 4_000);
    return () => clearInterval(id);
  }, []);

  async function subir(archivo: File, ruta: string) {
    setSubiendo(true); setError(''); setAviso('');
    try {
      const form = new FormData();
      form.append('archivo', archivo);
      const r = await fetch(`/api${ruta}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.leer()}` },
        body: form,
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message ?? 'No fue posible cargar el archivo');
      }
      const cuerpo = await r.json();
      setAviso(cuerpo.mensaje ?? `Procesado: ${JSON.stringify(cuerpo)}`);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <>
      {error && <div className="error">{error}</div>}
      {aviso && <div className="exito">{aviso}</div>}

      <div className="card">
        <h3>Base de pacientes</h3>
        <p className="nota">
          CSV exportado de la plataforma actual del cliente. Columnas mínimas: nombres, apellidos y
          número de identificación. Si trae servicio y fecha, alimenta el historial.
        </p>
        <label className="p-check">
          <input type="checkbox" checked={filtrar} onChange={(e) => setFiltrar(e.target.checked)} />
          Cargar solo pacientes con al menos un servicio en el último año (criterio acordado)
        </label>
        <input ref={inputPacientes} type="file" accept=".csv,.txt" style={{ display: 'none' }}
               onChange={(e) => {
                 const f = e.target.files?.[0];
                 if (f) void subir(f, `/carga?filtrarUltimoAnio=${filtrar}`);
                 e.target.value = '';
               }} />
        <div className="acciones">
          <button className="btn btn-primary" disabled={subiendo} onClick={() => inputPacientes.current?.click()}>
            {subiendo ? 'Subiendo…' : 'Seleccionar archivo'}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Contactos del celular</h3>
        <p className="nota">
          CSV de la agenda telefónica del cliente. No crea pacientes: es el directorio que permite
          saludar por su nombre a quien escribe sin estar registrado.
        </p>
        <input ref={inputContactos} type="file" accept=".csv,.txt" style={{ display: 'none' }}
               onChange={(e) => {
                 const f = e.target.files?.[0];
                 if (f) void subir(f, '/carga/contactos');
                 e.target.value = '';
               }} />
        <div className="acciones">
          <button className="btn btn-ghost" disabled={subiendo} onClick={() => inputContactos.current?.click()}>
            Seleccionar archivo
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Cargas recientes</h3>
        <table className="tabla">
          <thead>
            <tr><th>Archivo</th><th>Estado</th><th>Resultado</th><th></th></tr>
          </thead>
          <tbody>
            {trabajos.map((t) => (
              <tr key={t.id}>
                <td>{t.archivo}</td>
                <td>
                  <span className={`tag ${t.estado === 'completed' ? 't-green' : t.estado === 'failed' ? 't-red' : 't-amber'}`}>
                    {t.estado}
                  </span>
                  {typeof t.progreso === 'object' && t.progreso?.procesadas != null && (
                    <div className="muted">{t.progreso.procesadas.toLocaleString('es-CO')} filas</div>
                  )}
                </td>
                <td>
                  {t.resumen ? (
                    <span className="muted">
                      {t.resumen.creados} creados · {t.resumen.actualizados} actualizados ·{' '}
                      {t.resumen.duplicadosRechazados} duplicados · {t.resumen.fueraDeFiltro} fuera de filtro ·{' '}
                      {t.resumen.erroneos} con error
                    </span>
                  ) : <span className="muted">—</span>}
                </td>
                <td>
                  {t.resumen && t.resumen.erroneos > 0 && (
                    <a className="btn btn-ghost" href={`/api/carga/${t.id}/errores.csv`}
                       target="_blank" rel="noreferrer">Errores</a>
                  )}
                </td>
              </tr>
            ))}
            {trabajos.length === 0 && <tr><td colSpan={4} className="muted">Sin cargas registradas</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Registro append-only de todo cambio de estado relevante. */
function Auditoria() {
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(1);
  const [entidad, setEntidad] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.auditoria(pagina, entidad || undefined)
      .then((r) => { setRegistros(r.datos); setPaginas(r.paginas); })
      .catch((e: Error) => setError(e.message));
  }, [pagina, entidad]);

  return (
    <>
      {error && <div className="error">{error}</div>}

      <form className="buscador" onSubmit={(e) => { e.preventDefault(); setPagina(1); }}>
        <input placeholder="Filtrar por entidad (cita/M0104, paciente/…, agenda/…)"
               value={entidad} onChange={(e) => setEntidad(e.target.value)} />
        <button className="btn btn-primary" type="submit">Filtrar</button>
      </form>

      <div className="card">
        <table className="tabla">
          <thead>
            <tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th><th>Cambio</th></tr>
          </thead>
          <tbody>
            {registros.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.ts).toLocaleString('es-CO')}</td>
                <td>{r.usuario}</td>
                <td>{r.accion}</td>
                <td><span className="chip">{r.entidad}</span></td>
                <td className="muted">{r.detalle ?? '—'}</td>
                <td className="muted">
                  {r.estadoPrev || r.estadoNext ? `${r.estadoPrev ?? '—'} → ${r.estadoNext ?? '—'}` : '—'}
                </td>
              </tr>
            ))}
            {registros.length === 0 && <tr><td colSpan={6} className="muted">Sin registros</td></tr>}
          </tbody>
        </table>

        <div className="acciones">
          <button className="btn btn-ghost" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
          <span className="muted">Página {pagina} de {paginas}</span>
          <button className="btn btn-ghost" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
        </div>
      </div>
    </>
  );
}

/** RN-11 · Configuración por sala/servicio, con el frame multimedia. */
function Pantallas() {
  const [pantallas, setPantallas] = useState<Pantalla[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [editando, setEditando] = useState<Pantalla | null>(null);
  const [error, setError] = useState('');

  const recargar = () => { api.pantallas().then(setPantallas).catch((e: Error) => setError(e.message)); };
  useEffect(() => { recargar(); api.servicios().then(setServicios).catch(() => undefined); }, []);

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <p className="nota">
          Cada televisor define qué servicios muestra, cuántos turnos y su contenido multimedia.
          La pantalla se abre en el TV con <code>/tv?pantalla=&lt;id&gt;</code>.
        </p>
        <table className="tabla">
          <thead>
            <tr><th>Pantalla</th><th>Servicios</th><th>Turnos</th><th>Sonido</th><th>Multimedia</th><th></th></tr>
          </thead>
          <tbody>
            {pantallas.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td className="muted">{p.servicios.join(', ')}</td>
                <td>{p.turnosVisibles}</td>
                <td>{p.sonido ? 'Sí' : 'No'}</td>
                <td>
                  {p.media
                    ? <span className="tag t-teal">cada {p.intervaloInstitucionalMin} min</span>
                    : <span className="muted">Sin frame</span>}
                </td>
                <td className="acciones-fila">
                  <button className="btn btn-ghost" onClick={() => setEditando(p)}>Configurar</button>
                  {/* Relativo: en producción la TV cuelga de /tv del mismo dominio,
                      y en desarrollo el proxy de Vite lo resuelve igual. */}
                  <a className="btn btn-ghost" href={`${URL_PANTALLAS}?pantalla=${p.id}`}
                     target="_blank" rel="noreferrer">Abrir</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editando && (
        <FormPantalla pantalla={editando} servicios={servicios}
                      onCerrar={() => setEditando(null)}
                      onGuardado={() => { setEditando(null); recargar(); }} />
      )}
    </>
  );
}

function FormPantalla({ pantalla, servicios, onCerrar, onGuardado }: {
  pantalla: Pantalla; servicios: Servicio[]; onCerrar: () => void; onGuardado: () => void;
}) {
  const [f, setF] = useState({
    nombre: pantalla.nombre, turnosVisibles: pantalla.turnosVisibles, sonido: pantalla.sonido,
    mensaje: pantalla.mensaje ?? '', media: pantalla.media,
    canalYoutube: pantalla.canalYoutube ?? '',
    videosPromo: pantalla.videosPromo.join('\n'),
    intervaloInstitucionalMin: pantalla.intervaloInstitucionalMin,
  });
  const [sel, setSel] = useState<string[]>(pantalla.servicios);
  const [error, setError] = useState('');

  async function guardar() {
    setError('');
    try {
      await api.actualizarPantalla(pantalla.id, {
        nombre: f.nombre, servicios: sel, turnosVisibles: Number(f.turnosVisibles),
        sonido: f.sonido, mensaje: f.mensaje, media: f.media,
        canalYoutube: f.canalYoutube,
        videosPromo: f.videosPromo.split('\n').map((v) => v.trim()).filter(Boolean),
        intervaloInstitucionalMin: Number(f.intervaloInstitucionalMin),
      });
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>{pantalla.nombre}</h3>
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>Nombre</label>
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        </div>

        <div className="field">
          <label>Servicios que muestra</label>
          <div className="chips-seleccion">
            {servicios.map((s) => (
              <button key={s.id} type="button"
                      className={`chip-sel ${sel.includes(s.id) ? 'activo' : ''}`}
                      onClick={() => setSel(sel.includes(s.id) ? sel.filter((x) => x !== s.id) : [...sel, s.id])}>
                {s.nombre}
              </button>
            ))}
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Turnos visibles</label>
            <input type="number" min={1} max={12} value={f.turnosVisibles}
                   onChange={(e) => setF({ ...f, turnosVisibles: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Sonido al llamar</label>
            <select value={f.sonido ? 'si' : 'no'} onChange={(e) => setF({ ...f, sonido: e.target.value === 'si' })}>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label>Mensaje institucional</label>
          <textarea rows={2} value={f.mensaje} onChange={(e) => setF({ ...f, mensaje: e.target.value })} />
        </div>

        <label className="p-check">
          <input type="checkbox" checked={f.media} onChange={(e) => setF({ ...f, media: e.target.checked })} />
          Mostrar frame multimedia (canal en vivo + videos institucionales)
        </label>

        {f.media && (
          <>
            <div className="field">
              <label>Canal de noticias (YouTube)</label>
              <input value={f.canalYoutube} onChange={(e) => setF({ ...f, canalYoutube: e.target.value })}
                     placeholder="https://youtube.com/@canal/live" />
            </div>
            <div className="field">
              <label>Videos institucionales (uno por línea)</label>
              <textarea rows={3} value={f.videosPromo}
                        onChange={(e) => setF({ ...f, videosPromo: e.target.value })}
                        placeholder="https://youtube.com/watch?v=..." />
            </div>
            <div className="field">
              <label>Intervalo del video institucional (min)</label>
              <input type="number" min={1} max={120} value={f.intervaloInstitucionalMin}
                     onChange={(e) => setF({ ...f, intervaloInstitucionalMin: Number(e.target.value) })} />
              <span className="p-ayuda">
                Cada tantos minutos se interrumpe el canal para pasar el video institucional completo.
              </span>
            </div>
          </>
        )}

        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar}>Guardar</button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

/** D3 · el kiosko queda visible pero desactivado en esta etapa. */
function Kiosko() {
  const [estado, setEstado] = useState<EstadoKiosko | null>(null);

  useEffect(() => { api.kiosko().then(setEstado).catch(() => undefined); }, []);
  if (!estado) return <p className="muted">Cargando…</p>;

  return (
    <div className="card">
      <div className="kiosko-marca">
        {estado.activo ? 'Módulo activo' : estado.mensaje}
      </div>
      <h3>Kiosko de llegada</h3>
      <p className="nota">
        La operación real es: el paciente paga en recepción, pasa a sala de espera y el prestador
        lo llama. El kiosko queda en el producto para activarlo a futuro junto con el pago
        electrónico, sin necesidad de volver a desarrollarlo.
      </p>

      <div className="kiosko-preview">
        {estado.opciones.map((o) => (
          <div key={o.id} className="kiosko-opcion">{o.etiqueta}</div>
        ))}
      </div>
      <p className="nota">
        La dinámica definitiva de este menú la define el cliente. Para activarlo, cambia
        <code> kiosko_activo</code> en la pestaña Reglas.
      </p>
    </div>
  );
}

const DESCRIPCION: Record<string, string> = {
  hueco_max_min: 'Hueco máximo tolerado entre citas al recomendar horarios. 0 compacta al máximo.',
  ventana_control_dias_defecto: 'Ventana de control por defecto cuando el prestador no define la suya.',
  kiosko_activo: 'Activa el módulo de kiosko de llegada.',
  umbral_confianza_ia: 'Bajo este umbral de confianza, la IA escala a la asistente.',
  intervalo_institucional_min: 'Cada cuántos minutos se interrumpe el canal para el video institucional.',
  anticipacion_llegada_min: 'Minutos de anticipación con que se permite registrar la llegada.',
  tolerancia_retraso_min: 'Tolerancia de retraso antes de degradar la prioridad en cola.',
  whatsapp_seguimiento_portal_min: 'Minutos tras ofrecer el portal antes de preguntar si pudo agendar.',
  whatsapp_botones_interactivos: 'Usar botones de WhatsApp en vez de solo texto. Requiere aprobación del cliente.',
  documentacion_comercial: 'Documentación de servicios que usa el bot para responder vendiendo.',
};

/** Arquitectura §9 · los parámetros de reglas viven en la base, no en el código. */
function Configuracion() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [editado, setEditado] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const recargar = () => { api.configuracion().then(setConfig).catch((e: Error) => setError(e.message)); };
  useEffect(recargar, []);

  async function guardar(clave: string) {
    setError(''); setAviso('');
    try {
      await api.fijarConfiguracion(clave, editado[clave] ?? config[clave] ?? '');
      setAviso(`${clave} actualizado.`);
      setEditado(Object.fromEntries(Object.entries(editado).filter(([k]) => k !== clave)));
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <>
      {error && <div className="error">{error}</div>}
      {aviso && <div className="exito">{aviso}</div>}

      <div className="card">
        <p className="nota">
          Estos parámetros cambian el comportamiento del motor y del bot sin desplegar código.
          Todo cambio queda auditado.
        </p>
        <table className="tabla">
          <thead><tr><th>Parámetro</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            {Object.entries(config).sort().map(([clave, valor]) => (
              <tr key={clave}>
                <td>
                  <code>{clave}</code>
                  {DESCRIPCION[clave] && <div className="muted">{DESCRIPCION[clave]}</div>}
                </td>
                <td>
                  <input value={editado[clave] ?? valor}
                         onChange={(e) => setEditado({ ...editado, [clave]: e.target.value })} />
                </td>
                <td>
                  <button className="btn btn-ghost"
                          disabled={editado[clave] === undefined || editado[clave] === valor}
                          onClick={() => guardar(clave)}>
                    Guardar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
