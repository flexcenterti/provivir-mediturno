import { useEffect, useRef, useState } from 'react';
import {
  aHora, api, refrescarSesion, token, type DiaNoLaborable, type EstadoKiosko, type Pantalla,
  type RegistroAuditoria, type ResultadoDiaNoLaborable, type Servicio, type TrabajoCarga,
} from '../api';
import { Acceso } from './Acceso';
import { interpretarYoutube } from '@provivir/shared';

type Seccion = 'acceso' | 'carga' | 'auditoria' | 'pantallas' | 'kiosko' | 'festivos' | 'configuracion';

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
  { id: 'festivos', etiqueta: 'Días no laborables' },
  { id: 'configuracion', etiqueta: 'Reglas' },
];

export function Administracion({ inicial = 'acceso' }: { inicial?: Seccion } = {}) {
  const [seccion, setSeccion] = useState<Seccion>(inicial);

  return (
    <div className="vista">
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
      {seccion === 'festivos' && <DiasNoLaborables />}
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
      // FormData no pasa por `pedir` —fija Content-Type JSON—, así que la
      // renovación silenciosa hay que pedirla a mano: subir un CSV de 50.000
      // contactos justo cuando vence el token no puede costar el archivo.
      const enviar = async () =>
        fetch(`/api${ruta}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token.leer()}` },
          body: form,
        });

      let r = await enviar();
      if (r.status === 401 && (await refrescarSesion())) r = await enviar();

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

/** La URL que se pega en el televisor. Absoluta: viaja por WhatsApp o en un papel. */
function enlaceDe(pantallaId: string): string {
  return new URL(`${URL_PANTALLAS}?pantalla=${pantallaId}`, location.origin).href;
}

/**
 * Botón de copiar con acuse. `navigator.clipboard` exige contexto seguro (https o
 * localhost); si no lo hay, se muestra el enlace para copiarlo a mano en vez de fallar
 * en silencio, que es lo que hace un `catch` vacío.
 */
function CopiarEnlace({ pantallaId }: { pantallaId: string }) {
  const [estado, setEstado] = useState<'listo' | 'copiado' | 'manual'>('listo');

  if (estado === 'manual') {
    return <input className="enlace-manual" readOnly value={enlaceDe(pantallaId)}
                  onFocus={(e) => e.currentTarget.select()} />;
  }
  return (
    <button className="btn btn-ghost" onClick={() => {
      navigator.clipboard?.writeText(enlaceDe(pantallaId))
        .then(() => { setEstado('copiado'); setTimeout(() => setEstado('listo'), 2000); })
        .catch(() => setEstado('manual'));
    }}>
      {estado === 'copiado' ? 'Copiado' : 'Copiar enlace'}
    </button>
  );
}

/** RN-11 · Configuración por sala/servicio, con el frame multimedia. */
function Pantallas() {
  const [pantallas, setPantallas] = useState<Pantalla[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [editando, setEditando] = useState<Pantalla | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState('');

  const recargar = () => { api.pantallas().then(setPantallas).catch((e: Error) => setError(e.message)); };
  useEffect(() => { recargar(); api.servicios().then(setServicios).catch(() => undefined); }, []);

  async function eliminar(p: Pantalla) {
    /*
     * `confirm()` y no un modal propio: es lo que ya usa el borrado de perfiles. El
     * texto dice qué se rompe, porque esto es a la vez el error de un clic de más y el
     * procedimiento de revocación de un enlace filtrado — quien borra a propósito
     * necesita saber que funcionó.
     */
    if (!confirm(
      `¿Retirar «${p.nombre}»?\n\n`
      + 'El televisor que tenga su enlace dejará de funcionar, y el enlace no se puede '
      + 'recuperar: si vuelves a crear la pantalla tendrá uno nuevo.',
    )) return;

    setError('');
    try {
      await api.eliminarPantalla(p.id);
      setEditando(null);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <>
      {error && <div className="error">{error}</div>}
      <div className="card">
        <div className="acciones">
          <button className="btn btn-primary" onClick={() => setCreando(true)}>Nueva pantalla</button>
        </div>
        <p className="nota">
          Cada televisor define qué servicios muestra, cuántos turnos y su contenido multimedia.
          La pantalla se abre en el TV con <code>/tv?pantalla=&lt;id&gt;</code>.
        </p>
        <table className="tabla">
          <thead>
            <tr><th>Pantalla</th><th>Servicios</th><th>Turnos</th><th>Sonido</th><th>Multimedia</th><th></th></tr>
          </thead>
          <tbody>
            {/* Sin esto la tabla es encabezados sobre el vacío, sin decir qué hacer. */}
            {pantallas.length === 0 && (
              <tr><td colSpan={6} className="muted">
                Todavía no hay ninguna pantalla. Crea una, elige qué servicios muestra y
                abre su enlace en el televisor de la sala.
              </td></tr>
            )}
            {pantallas.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.nombre}
                  {/* El único modo de correlacionar «qué pantalla es ese televisor»
                      cuando alguien te lee la barra del navegador por teléfono. */}
                  <div className="uuid">{p.id}</div>
                </td>
                <td className="muted">
                  {p.servicios.length
                    ? p.servicios.join(', ')
                    : <span className="tag t-amber">Sin servicios · no mostrará llamados</span>}
                </td>
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
                  {/* Quien configura está en un escritorio y el televisor está en otra
                      sala: «Abrir» no sirve para la tarea real, copiar el enlace sí. */}
                  <CopiarEnlace pantallaId={p.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editando || creando) && (
        <FormPantalla pantalla={editando} servicios={servicios}
                      onCerrar={() => { setEditando(null); setCreando(false); }}
                      onEliminar={editando ? () => eliminar(editando) : undefined}
                      onGuardado={() => { setEditando(null); setCreando(false); recargar(); }} />
      )}
    </>
  );
}

/** Dice en el acto si lo pegado sirve, y qué poner si no. */
function PistaYoutube({ valor }: { valor: string }) {
  if (!valor.trim()) return <span className="p-ayuda">Vacío: la pantalla emitirá solo los institucionales.</span>;

  const r = interpretarYoutube(valor);
  if (r.tipo === 'directo') return <span className="p-ayuda ok">✓ Canal en directo · {r.canalId}</span>;
  if (r.tipo === 'video') return <span className="p-ayuda ok">✓ Video en bucle · {r.videoId}</span>;
  return <span className="p-ayuda mal">{r.motivo}</span>;
}

/** Un solo formulario para los dos verbos: `pantalla` en `null` es crear. */
function FormPantalla({ pantalla, servicios, onCerrar, onGuardado, onEliminar }: {
  pantalla: Pantalla | null; servicios: Servicio[];
  onCerrar: () => void; onGuardado: () => void; onEliminar?: () => void;
}) {
  const [f, setF] = useState({
    nombre: pantalla?.nombre ?? '',
    turnosVisibles: pantalla?.turnosVisibles ?? 4,
    sonido: pantalla?.sonido ?? true,
    mensaje: pantalla?.mensaje ?? '', media: pantalla?.media ?? false,
    canalYoutube: pantalla?.canalYoutube ?? '',
    videosPromo: (pantalla?.videosPromo ?? []).join('\n'),
    intervaloInstitucionalMin: pantalla?.intervaloInstitucionalMin ?? 10,
  });
  const [sel, setSel] = useState<string[]>(pantalla?.servicios ?? []);
  const [error, setError] = useState('');

  async function guardar() {
    setError('');
    const cuerpo = {
      nombre: f.nombre, servicios: sel, turnosVisibles: Number(f.turnosVisibles),
      sonido: f.sonido, mensaje: f.mensaje, media: f.media,
      canalYoutube: f.canalYoutube,
      videosPromo: f.videosPromo.split('\n').map((v) => v.trim()).filter(Boolean),
      intervaloInstitucionalMin: Number(f.intervaloInstitucionalMin),
    };
    try {
      if (pantalla) await api.actualizarPantalla(pantalla.id, cuerpo);
      else await api.crearPantalla(cuerpo);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>{pantalla ? pantalla.nombre : 'Nueva pantalla'}</h3>
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
          {/* Se avisa antes de guardar, no cuando alguien descubra el televisor mudo
              en la sala. Se permite: es el estado normal de una pantalla a medio
              configurar. */}
          {sel.length === 0 && (
            <span className="p-ayuda mal">Sin servicios esta pantalla no mostrará ningún llamado.</span>
          )}
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
              <label htmlFor="p-canal">Canal de noticias (YouTube)</label>
              <input id="p-canal" value={f.canalYoutube}
                     onChange={(e) => setF({ ...f, canalYoutube: e.target.value })}
                     placeholder="UC2Xq2PK-got3Rtz9ZJ32hLQ" />
              {/* El @handle NO sirve para embeber un directo, y era lo que sugería el
                  marcador anterior. Se avisa al escribir, no al descubrir la pantalla
                  en negro en la sala de espera. */}
              <PistaYoutube valor={f.canalYoutube} />
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
          <button className="btn btn-primary" onClick={guardar}>
            {pantalla ? 'Guardar' : 'Crear pantalla'}
          </button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          {onEliminar && (
            <button className="btn btn-danger" onClick={onEliminar}>Retirar pantalla</button>
          )}
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

/**
 * RN-06.5 · Días en que la sede no atiende.
 *
 * Los festivos nacionales se importan calculados (son 18 al año y doce se mueven);
 * los cierres propios —inventario, capacitación— se añaden a mano. Cerrar un día con
 * pacientes citados muestra primero a cuántos afecta, igual que bloquear una agenda.
 */
function DiasNoLaborables() {
  const ahora = new Date().getFullYear();
  const [anio, setAnio] = useState(ahora);
  const [dias, setDias] = useState<DiaNoLaborable[]>([]);
  const [fecha, setFecha] = useState('');
  const [motivo, setMotivo] = useState('');
  const [impacto, setImpacto] = useState<ResultadoDiaNoLaborable | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const recargar = (a: number) => { api.diasNoLaborables(a).then(setDias).catch(() => undefined); };
  useEffect(() => { recargar(anio); }, [anio]);

  async function importar() {
    setError(''); setAviso('');
    try {
      const r = await api.importarFestivos(anio);
      setAviso(`${r.importados} festivo(s) añadido(s); ${r.yaEstaban} ya estaban.`);
      recargar(anio);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }

  /** Primero simula: cerrar un día con citas es una decisión informada. */
  async function cerrar(confirmar: boolean) {
    setError(''); setAviso('');
    if (!fecha || !motivo.trim()) { setError('Indica la fecha y el motivo'); return; }
    try {
      const r = await api.crearDiaNoLaborable({ fecha, motivo, confirmar });
      if (r.simulacion) { setImpacto(r); return; }
      setImpacto(null); setAviso(r.mensaje); setFecha(''); setMotivo('');
      recargar(anio);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }

  async function reabrir(d: DiaNoLaborable) {
    setError(''); setAviso('');
    try {
      await api.eliminarDiaNoLaborable(d.id);
      setAviso(`El ${d.fecha} vuelve a ser laborable.`);
      recargar(anio);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
  }

  return (
    <div>
      <p className="sub" style={{ marginBottom: '1rem' }}>
        Ningún canal ofrece ni agenda citas en estos días: ni el portal, ni WhatsApp, ni el
        mostrador. La clínica no atiende domingos, que no se programan en las agendas.
      </p>

      {error && <div className="error" role="alert">{error}</div>}
      {aviso && <div className="aviso" role="status">{aviso}</div>}

      <div className="fila" style={{ gap: '.6rem', alignItems: 'end', marginBottom: '1rem' }}>
        <label className="campo">
          Año
          <input type="number" min={2020} max={2100} value={anio}
                 onChange={(e) => setAnio(Number(e.target.value))} />
        </label>
        <button className="btn btn-ghost" onClick={importar}>Importar festivos de {anio}</button>
      </div>

      <div className="fila" style={{ gap: '.6rem', alignItems: 'end', marginBottom: '1rem' }}>
        <label className="campo">
          Cerrar un día
          <input type="date" value={fecha} onChange={(e) => { setFecha(e.target.value); setImpacto(null); }} />
        </label>
        <label className="campo" style={{ flex: 1 }}>
          Motivo
          <input value={motivo} maxLength={120} placeholder="Inventario, capacitación…"
                 onChange={(e) => { setMotivo(e.target.value); setImpacto(null); }} />
        </label>
        <button className="btn btn-primary" onClick={() => cerrar(false)}>Revisar impacto</button>
      </div>

      {impacto && (
        <div className="tarjeta" style={{ marginBottom: '1rem' }}>
          <p>{impacto.mensaje}</p>
          {impacto.citas.length > 0 && (
            <table className="tabla">
              <thead><tr><th>Código</th><th>Hora</th><th>Paciente</th><th>Prestador</th><th>Servicio</th></tr></thead>
              <tbody>
                {impacto.citas.map((c) => (
                  <tr key={c.id}>
                    <td>{c.codigo}</td>
                    <td>{aHora(c.horaInicio)}</td>
                    <td>{c.paciente.nombres} {c.paciente.apellidos}</td>
                    <td>{c.prestador.nombre}</td>
                    <td>{c.servicio.nombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {/* Las citas no se cancelan solas: las reprograma una asistente (RN-06.3). */}
          <button className="btn btn-primary" onClick={() => cerrar(true)}>
            Confirmar cierre del {fecha}
          </button>
        </div>
      )}

      <table className="tabla">
        <thead><tr><th>Fecha</th><th>Motivo</th><th>Tipo</th><th /></tr></thead>
        <tbody>
          {dias.map((d) => (
            <tr key={d.id}>
              <td>{d.fecha.slice(0, 10)}</td>
              <td>{d.motivo}</td>
              <td><span className={`tag ${d.tipo === 'festivo' ? 't-teal' : ''}`}>{d.tipo}</span></td>
              <td><button className="btn btn-ghost" onClick={() => reabrir(d)}>Reabrir</button></td>
            </tr>
          ))}
          {dias.length === 0 && (
            <tr><td colSpan={4} className="sub">Sin días cerrados en {anio}. Importa los festivos nacionales.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const DESCRIPCION: Record<string, string> = {
  hueco_max_min: 'Hueco máximo tolerado entre citas al recomendar horarios. 0 compacta al máximo.',
  ventana_control_dias_defecto: 'Ventana de control por defecto cuando el prestador no define la suya.',
  agendamiento_anticipacion_dias: 'Días de anticipación que exigen el portal y WhatsApp. 1 = solo desde mañana; 0 permite hoy. No aplica al personal en sede.',
  kiosko_activo: 'Activa el módulo de kiosko de llegada.',
  politica_datos_url: 'Enlace a la política de tratamiento de datos que el bot muestra en el primer contacto.',
  umbral_confianza_ia: 'Bajo este umbral de confianza, la IA escala a la asistente.',
  intervalo_institucional_min: 'Cada cuántos minutos se interrumpe el canal para el video institucional.',
  anticipacion_llegada_min: 'Minutos de anticipación con que se permite registrar la llegada.',
  tolerancia_retraso_min: 'Tolerancia de retraso antes de degradar la prioridad en cola.',
  whatsapp_seguimiento_portal_min: 'Minutos tras ofrecer el portal antes de preguntar si pudo agendar.',
  whatsapp_botones_interactivos: 'Usar botones de WhatsApp en vez de solo texto. Apagado, el aviso de datos pide responder ACEPTO.',
  documentacion_comercial: 'Documentación de servicios que usa el bot para responder vendiendo.',
  /*
   * Las plantillas de Meta se escriben aquí y sin explicación no se sabe qué poner:
   * lo que va en la casilla es el NOMBRE aprobado en el Business Manager, no el
   * texto del mensaje. Vacías, la plataforma no intenta el envío y lo dice.
   */
  plantilla_recordatorio_24h: 'Nombre de la plantilla aprobada en Meta para el recordatorio de 24 h antes. Cuatro variables, en este orden: código, servicio, fecha y hora. Vacío = fuera de la ventana de 24 h el recordatorio no se envía y queda en auditoría.',
  plantilla_recordatorio_hoy: 'Igual que la anterior, para el recordatorio del mismo día. Mismas cuatro variables.',
  plantilla_confirmacion_cita: 'Plantilla para confirmar una cita agendada en el portal. Quien agenda por web no suele haber escrito por WhatsApp, así que este envío casi siempre la necesita. Mismas cuatro variables.',
  plantilla_cancelacion_cita: 'Plantilla para avisar de una cita cancelada. Mismas cuatro variables. No sirve la de confirmación: dice lo contrario.',
  plantilla_reapertura_conversacion: 'Plantilla para retomar una conversación cerrada hace más de 24 h. UNA sola variable: el nombre del paciente. Sin ella, la bandeja no ofrece el envío.',
  plantilla_contacto_inicial: 'Plantilla para escribirle PRIMERO a quien nunca ha usado el chat, como el que agenda por el portal. UNA sola variable: el nombre. Si no quieres tramitar una sexta plantilla ante Meta, pega aquí el mismo nombre que en la de reapertura. Sin ella, «Escribirle» sale deshabilitado.',
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
