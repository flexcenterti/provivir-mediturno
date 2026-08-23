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

/**
 * El id es la clave estable con la que el motor referencia a un prestador o un
 * servicio, y aparece en las agendas y en las herramientas de la IA. Se propone a
 * partir del nombre para que nadie tenga que inventárselo, pero se deja editable:
 * cambiarlo después obligaría a migrar datos.
 */
function proponerId(nombre: string): string {
  return nombre
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function Prestadores() {
  const [prestadores, setPrestadores] = useState<PrestadorDetalle[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [editando, setEditando] = useState<PrestadorDetalle | 'nuevo' | null>(null);
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
      {error && <div className="error" role="alert">{error}</div>}
      <div className="card">
        <div className="panel-cab">
          <p className="nota" style={{ margin: 0 }}>
            El balanceo de carga aplica <strong>solo</strong> a los prestadores marcados como medicina general.
            Los especialistas atienden por fechas y no balancean.
          </p>
          <button className="btn btn-primary" onClick={() => setEditando('nuevo')}>Nuevo prestador</button>
        </div>
        <table className="tabla">
          <thead>
            <tr><th>Prestador</th><th>Especialidad</th><th>Balanceo</th><th>Ventana control</th><th>Duraciones</th><th></th></tr>
          </thead>
          <tbody>
            {prestadores.map((p) => (
              <tr key={p.id} className={p.activo ? '' : 'inactiva'}>
                <td>
                  {p.nombre}
                  {!p.activo && <span className="etiqueta"> retirado</span>}
                  <br /><span className="muted">{p.consultorio ?? 'sin consultorio'}</span>
                </td>
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
          prestador={editando === 'nuevo' ? null : editando}
          servicios={servicios}
          idsUsados={prestadores.map((p) => p.id)}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); recargar(); }}
        />
      )}
    </>
  );
}

function FormPrestador({ prestador, servicios, idsUsados, onCerrar, onGuardado }: {
  prestador: PrestadorDetalle | null;
  servicios: Servicio[];
  idsUsados: string[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const esNuevo = prestador === null;

  const [id, setId] = useState(prestador?.id ?? '');
  const [idTocado, setIdTocado] = useState(false);
  const [nombre, setNombre] = useState(prestador?.nombre ?? '');
  const [especialidad, setEspecialidad] = useState(prestador?.especialidad ?? '');
  const [vinculacion, setVinculacion] = useState(prestador?.vinculacion ?? 'Interno');
  const [consultorio, setConsultorio] = useState(prestador?.consultorio ?? '');
  const [balanceo, setBalanceo] = useState(prestador?.grupoBalanceo ?? false);
  const [activo, setActivo] = useState(prestador?.activo ?? true);
  const [ventana, setVentana] = useState(prestador?.config?.ventanaControlDias ?? 10);
  const [duraciones, setDuraciones] = useState<Record<string, number>>(
    Object.fromEntries((prestador?.servicios ?? []).map((s) => [s.servicioId, s.duracionMin])),
  );
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  // El id se propone solo hasta que alguien lo escribe a mano.
  const cambiarNombre = (v: string) => {
    setNombre(v);
    if (esNuevo && !idTocado) setId(proponerId(v));
  };

  const idRepetido = esNuevo && idsUsados.includes(id);
  const listo = nombre.trim().length >= 3 && especialidad.trim() !== '' && (!esNuevo || (id !== '' && !idRepetido));

  async function guardar() {
    setError(''); setGuardando(true);
    const duracionesLista = Object.entries(duraciones)
      .filter(([, min]) => min > 0)
      .map(([servicioId, duracionMin]) => ({ servicioId, duracionMin }));

    try {
      if (esNuevo) {
        await api.crearPrestador({
          id, nombre, especialidad, vinculacion, consultorio,
          grupoBalanceo: balanceo, ventanaControlDias: Number(ventana),
          duraciones: duracionesLista,
        });
      } else {
        // `vinculacion` no se admite al actualizar: es del alta.
        await api.actualizarPrestador(prestador.id, {
          nombre, especialidad, consultorio, grupoBalanceo: balanceo, activo,
          ventanaControlDias: Number(ventana), duraciones: duracionesLista,
        });
      }
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setGuardando(false);
    }
  }

  const alternar = (idServicio: string, min: number) => {
    const copia = { ...duraciones };
    if (min <= 0) delete copia[idServicio]; else copia[idServicio] = min;
    setDuraciones(copia);
  };

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>{esNuevo ? 'Nuevo prestador' : prestador.nombre}</h3>
        {error && <div className="error" role="alert">{error}</div>}

        <div className="grid-2">
          <div className="field">
            <label htmlFor="pr-nombre">Nombre</label>
            <input id="pr-nombre" value={nombre} onChange={(e) => cambiarNombre(e.target.value)}
                   placeholder="Dra. Marcela Duarte" required />
          </div>
          <div className="field">
            <label htmlFor="pr-esp">Especialidad</label>
            <input id="pr-esp" value={especialidad} onChange={(e) => setEspecialidad(e.target.value)}
                   placeholder="Ginecología" required />
          </div>
        </div>

        {/* El id solo se elige al crear: cambiarlo después rompería agendas y citas. */}
        {esNuevo && (
          <div className="field">
            <label htmlFor="pr-id">Identificador</label>
            <input id="pr-id" value={id}
                   onChange={(e) => { setId(proponerId(e.target.value)); setIdTocado(true); }} />
            <span className={`p-ayuda ${idRepetido ? 'mal' : ''}`}>
              {idRepetido
                ? 'Ya existe un prestador con ese identificador.'
                : 'Se propone desde el nombre. No se puede cambiar después: las agendas y las citas lo referencian.'}
            </span>
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label htmlFor="pr-consultorio">Consultorio</label>
            <input id="pr-consultorio" value={consultorio} onChange={(e) => setConsultorio(e.target.value)}
                   placeholder="Consultorio 5" />
          </div>
          {esNuevo && (
            <div className="field">
              <label htmlFor="pr-vinc">Vinculación</label>
              <select id="pr-vinc" value={vinculacion} onChange={(e) => setVinculacion(e.target.value)}>
                <option value="Interno">Interno</option>
                <option value="Externo">Externo</option>
              </select>
              <span className="p-ayuda">Los externos suelen atender por fechas puntuales (RN-04.1).</span>
            </div>
          )}
        </div>

        <label className="p-check">
          <input type="checkbox" checked={balanceo} onChange={(e) => setBalanceo(e.target.checked)} />
          Pertenece al grupo de medicina general (participa del balanceo de carga)
        </label>

        {/* Retirar en vez de borrar: sus citas pasadas siguen existiendo. */}
        {!esNuevo && (
          <label className="p-check">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo · al desmarcarlo deja de ofrecerse en cupos nuevos, sin tocar sus citas ya agendadas
          </label>
        )}

        <div className="field">
          <label htmlFor="pr-ventana">Ventana de cita de control (días)</label>
          <input id="pr-ventana" type="number" min={1} max={365} value={ventana}
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
          {!servicios.length && (
            <span className="p-ayuda mal">No hay servicios todavía: créalos primero para poder asignarle duraciones.</span>
          )}
        </div>

        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar} disabled={!listo || guardando}>
            {guardando ? 'Guardando…' : esNuevo ? 'Crear' : 'Guardar'}
          </button>
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
  const [editando, setEditando] = useState<Servicio | 'nuevo' | null>(null);
  const [error, setError] = useState('');

  const recargar = () => { api.servicios().then(setServicios).catch((e: Error) => setError(e.message)); };
  useEffect(recargar, []);

  return (
    <>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="card">
        <div className="panel-cab">
          <p className="nota" style={{ margin: 0 }}>
            El tipo decide cómo trata el motor cada servicio, y no se puede cambiar después.
          </p>
          <button className="btn btn-primary" onClick={() => setEditando('nuevo')}>Nuevo servicio</button>
        </div>
        <table className="tabla">
          <thead>
            <tr><th>Servicio</th><th>Categoría</th><th>Tipo</th><th>Duración</th><th>Cupos</th><th></th></tr>
          </thead>
          <tbody>
            {servicios.map((s) => (
              <tr key={s.id} className={s.activo === false ? 'inactiva' : ''}>
                <td>
                  {s.nombre}
                  {s.activo === false && <span className="etiqueta"> retirado</span>}
                  {s.requiereOrden && <span className="tag t-blue"> requiere orden</span>}
                </td>
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
        {!servicios.length && <p className="muted">Sin servicios todavía.</p>}
      </div>

      {editando && (
        <FormServicio
          servicio={editando === 'nuevo' ? null : editando}
          idsUsados={servicios.map((s) => s.id)}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); recargar(); }}
        />
      )}
    </>
  );
}

const TIPOS: Array<{ id: string; etiqueta: string; ayuda: string }> = [
  { id: 'general', etiqueta: 'Consulta general', ayuda: 'La consulta corriente. Puede originar un control.' },
  { id: 'control', etiqueta: 'Cita de control', ayuda: 'Seguimiento de una consulta previa, dentro de la ventana del prestador (RN-01).' },
  { id: 'procedimiento', etiqueta: 'Procedimiento', ayuda: 'Duración propia, normalmente larga (RN-04.3).' },
  { id: 'examen', etiqueta: 'Examen', ayuda: 'Diagnóstico o laboratorio. Suele requerir orden médica.' },
];

const POLITICAS: Array<{ id: string; etiqueta: string }> = [
  { id: 'costo_pleno', etiqueta: 'Costo pleno' },
  { id: 'sin_costo', etiqueta: 'Sin costo' },
  { id: 'porcentaje', etiqueta: 'Porcentaje' },
];

function FormServicio({ servicio, idsUsados, onCerrar, onGuardado }: {
  servicio: Servicio | null;
  idsUsados: string[];
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const esNuevo = servicio === null;

  const [id, setId] = useState(servicio?.id ?? '');
  const [idTocado, setIdTocado] = useState(false);
  const [f, setF] = useState({
    nombre: servicio?.nombre ?? '',
    categoria: servicio?.categoria ?? '',
    tipo: servicio?.tipo ?? 'general',
    duracionMin: servicio?.duracionMin ?? 15,
    cupos: servicio?.cupos ?? 1,
    requiereOrden: servicio?.requiereOrden ?? false,
    politicaCosto: servicio?.politicaCosto ?? 'costo_pleno',
    activo: servicio?.activo ?? true,
    // Ficha comercial (RN-04.5.1) · es lo que el bot usa para vender.
    descripcionComercial: servicio?.descripcionComercial ?? '',
    beneficios: (servicio?.beneficios ?? []).join('\n'),
    preparacion: servicio?.preparacion ?? '',
    rangoPrecio: servicio?.rangoPrecio ?? '',
    agendable: servicio?.agendable ?? true,
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cambiarNombre = (v: string) => {
    setF({ ...f, nombre: v });
    if (esNuevo && !idTocado) setId(proponerId(v));
  };

  const idRepetido = esNuevo && idsUsados.includes(id);
  const listo = f.nombre.trim().length >= 3 && f.categoria.trim() !== '' && (!esNuevo || (id !== '' && !idRepetido));

  async function guardar() {
    setError(''); setGuardando(true);
    const comun = {
      nombre: f.nombre, categoria: f.categoria,
      duracionMin: Number(f.duracionMin), cupos: Number(f.cupos),
      requiereOrden: f.requiereOrden, politicaCosto: f.politicaCosto,
      descripcionComercial: f.descripcionComercial.trim() || undefined,
      beneficios: f.beneficios.split('\n').map((b) => b.trim()).filter(Boolean),
      preparacion: f.preparacion.trim() || undefined,
      rangoPrecio: f.rangoPrecio.trim() || undefined,
      agendable: f.agendable,
    };
    try {
      if (esNuevo) await api.crearServicio({ id, tipo: f.tipo, ...comun });
      // El tipo no viaja al actualizar: define cómo lo trata el motor.
      else await api.actualizarServicio(servicio.id, { ...comun, activo: f.activo });
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setGuardando(false);
    }
  }

  const tipoElegido = TIPOS.find((t) => t.id === f.tipo);

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{esNuevo ? 'Nuevo servicio' : servicio.nombre}</h3>
        {error && <div className="error" role="alert">{error}</div>}

        <div className="field">
          <label htmlFor="sv-nombre">Nombre</label>
          <input id="sv-nombre" value={f.nombre} onChange={(e) => cambiarNombre(e.target.value)}
                 placeholder="Medicina general · Consulta" required />
        </div>
        <div className="field">
          <label htmlFor="sv-cat">Categoría</label>
          <input id="sv-cat" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}
                 placeholder="Especialista" required />
          <span className="p-ayuda">Agrupa los servicios en el portal del paciente.</span>
        </div>

        {esNuevo && (
          <>
            <div className="field">
              <label htmlFor="sv-id">Identificador</label>
              <input id="sv-id" value={id}
                     onChange={(e) => { setId(proponerId(e.target.value)); setIdTocado(true); }} />
              <span className={`p-ayuda ${idRepetido ? 'mal' : ''}`}>
                {idRepetido
                  ? 'Ya existe un servicio con ese identificador.'
                  : 'No se puede cambiar después: las citas y las agendas lo referencian.'}
              </span>
            </div>
            <div className="field">
              <label htmlFor="sv-tipo">Tipo de cita</label>
              <select id="sv-tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
                {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.etiqueta}</option>)}
              </select>
              <span className="p-ayuda">{tipoElegido?.ayuda}</span>
            </div>
          </>
        )}

        <div className="grid-2">
          <div className="field">
            <label htmlFor="sv-dur">Duración (min)</label>
            <input id="sv-dur" type="number" min={5} max={480} step={5} value={f.duracionMin}
                   onChange={(e) => setF({ ...f, duracionMin: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="sv-cupos">Cupos que ocupa</label>
            <input id="sv-cupos" type="number" min={1} max={8} value={f.cupos}
                   onChange={(e) => setF({ ...f, cupos: Number(e.target.value) })} />
            <span className="p-ayuda">La ecografía Doppler ocupa 2.</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="sv-costo">Política de costo</label>
          <select id="sv-costo" value={f.politicaCosto} onChange={(e) => setF({ ...f, politicaCosto: e.target.value })}>
            {POLITICAS.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
          <span className="p-ayuda">El control dentro de la ventana no tiene costo (RN-01.2).</span>
        </div>

        <label className="p-check">
          <input type="checkbox" checked={f.requiereOrden}
                 onChange={(e) => setF({ ...f, requiereOrden: e.target.checked })} />
          Requiere orden médica
        </label>

        {!esNuevo && (
          <>
            {(Number(f.duracionMin) !== servicio.duracionMin || Number(f.cupos) !== servicio.cupos) && (
              <p className="aviso">
                Cambiar duración o cupos afecta solo a las citas que se creen desde ahora. Las ya
                agendadas conservan su configuración (RN-04.5.2).
              </p>
            )}
            <label className="p-check">
              <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} />
              Activo · al desmarcarlo deja de ofrecerse, sin tocar las citas ya agendadas
            </label>
            {!f.activo && servicio.activo && (
              <p className="aviso">
                Al desactivarlo se cancelan los seguimientos comerciales de este servicio y sus
                artículos de conocimiento quedan marcados para revisión.
              </p>
            )}
          </>
        )}

        <fieldset className="ficha-comercial">
          <legend>Ficha comercial</legend>
          <p className="p-ayuda">
            Es lo que el bot dice de este servicio. Sin descripción ni beneficios no lo ofrece
            por WhatsApp ni por el portal: no puede venderlo si no sabe qué decir de él.
          </p>

          <div className="field">
            <label htmlFor="sv-desc">Descripción</label>
            <textarea id="sv-desc" rows={2} value={f.descripcionComercial}
                      placeholder="Qué es y para qué sirve, en palabras de paciente"
                      onChange={(e) => setF({ ...f, descripcionComercial: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="sv-benef">Beneficios · uno por línea</label>
            <textarea id="sv-benef" rows={3} value={f.beneficios}
                      placeholder={'Resultado el mismo día\nNo requiere remisión externa'}
                      onChange={(e) => setF({ ...f, beneficios: e.target.value })} />
            <span className="p-ayuda">El seguimiento usa uno distinto en cada mensaje, para no repetirse.</span>
          </div>

          <div className="field">
            <label htmlFor="sv-prep">Preparación</label>
            <textarea id="sv-prep" rows={2} value={f.preparacion}
                      placeholder="Ayuno de 6 horas, ropa cómoda…"
                      onChange={(e) => setF({ ...f, preparacion: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="sv-precio">Rango de precio</label>
            <input id="sv-precio" value={f.rangoPrecio}
                   placeholder="Opcional · el bot lo cita tal cual"
                   onChange={(e) => setF({ ...f, rangoPrecio: e.target.value })} />
          </div>

          <label className="p-check">
            <input type="checkbox" checked={f.agendable}
                   onChange={(e) => setF({ ...f, agendable: e.target.checked })} />
            Agendable por WhatsApp y portal
          </label>
        </fieldset>

        {!esNuevo && <p className="nota">El tipo de cita no se cambia: define cómo lo trata el motor de agendamiento.</p>}

        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar} disabled={!listo || guardando}>
            {guardando ? 'Guardando…' : esNuevo ? 'Crear' : 'Guardar'}
          </button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
