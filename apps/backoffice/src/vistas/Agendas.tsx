import { useEffect, useState } from 'react';
import {
  aHora, api, hoyIso,
  type Agenda, type Prestador, type ResultadoBloqueo, type ResultadoImpacto, type Servicio,
} from '../api';

const DIAS = [
  { n: 1, e: 'Lun' }, { n: 2, e: 'Mar' }, { n: 3, e: 'Mié' }, { n: 4, e: 'Jue' },
  { n: 5, e: 'Vie' }, { n: 6, e: 'Sáb' }, { n: 7, e: 'Dom' },
];

/**
 * Especificación §2.5 · Gestión de agendas.
 * Solo administración modifica disponibilidad; el prestador la ve en solo lectura.
 */
export function Agendas() {
  const [agendas, setAgendas] = useState<Agenda[]>([]);
  const [prestadores, setPrestadores] = useState<Prestador[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [filtro, setFiltro] = useState('');
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<Agenda | null>(null);
  const [verRetiradas, setVerRetiradas] = useState(false);
  const [mensual, setMensual] = useState(false);
  const [bloqueando, setBloqueando] = useState<Agenda | null>(null);
  const [error, setError] = useState('');

  const recargar = () => {
    api.agendas(filtro || undefined, verRetiradas).then(setAgendas).catch((e: Error) => setError(e.message));
  };
  useEffect(recargar, [filtro, verRetiradas]);
  useEffect(() => {
    Promise.all([api.prestadores(), api.servicios()])
      .then(([p, s]) => { setPrestadores(p); setServicios(s); })
      .catch(() => undefined);
  }, []);

  return (
    <div className="vista">
      <header className="vista-cab">
        <div>
          <p className="nota">
            Solo administración crea, modifica o bloquea disponibilidad. Los prestadores la ven
            en modo solo lectura.
          </p>
        </div>
        <div className="acciones">
          <button className="btn btn-ghost" onClick={() => setMensual(true)}>Programación mensual</button>
          <button className="btn btn-primary" onClick={() => setCreando(true)}>Nueva agenda</button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="controles">
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todos los prestadores</option>
          {prestadores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <label className="p-check">
          <input type="checkbox" checked={verRetiradas}
                 onChange={(e) => setVerRetiradas(e.target.checked)} />
          Ver retiradas
        </label>
        <span className="muted">{agendas.length} agenda(s)</span>
      </div>

      <div className="card">
        <table className="tabla">
          <thead>
            <tr><th>Prestador</th><th>Modo</th><th>Días / fecha</th><th>Franja</th><th>Slot</th><th>Consultorio</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {agendas.map((a) => (
              <tr key={a.id}>
                <td>{a.prestador?.nombre ?? a.prestadorId}</td>
                <td>{a.modo === 'semanal' ? 'Semanal' : 'Calendario'}</td>
                <td>
                  {a.modo === 'semanal'
                    ? DIAS.filter((d) => a.diasSemana.includes(d.n)).map((d) => d.e).join(', ')
                    : a.fecha?.slice(0, 10)}
                </td>
                <td>{a.horaIni}–{a.horaFin}</td>
                <td>{a.slotMin} min</td>
                <td className="muted">{a.consultorio ?? '—'}</td>
                <td>
                  {!a.activa
                    ? <span className="tag t-gray">Retirada</span>
                    : a.bloqueada
                      ? <span className="tag t-red" title={a.motivoBloqueo ?? ''}>Bloqueada</span>
                      : <span className="tag t-green">Activa</span>}
                </td>
                <td className="acciones-fila">
                  {!a.activa ? (
                    <button className="btn btn-ghost"
                            onClick={() => api.reactivarAgenda(a.id).then(recargar).catch((e: Error) => setError(e.message))}>
                      Reactivar
                    </button>
                  ) : (
                    <>
                      <button className="btn btn-ghost" onClick={() => setEditando(a)}>Editar</button>
                      {a.bloqueada
                        ? <button className="btn btn-ghost" onClick={() => api.desbloquearAgenda(a.id).then(recargar)}>Desbloquear</button>
                        : <button className="btn btn-ghost" onClick={() => setBloqueando(a)}>Bloquear</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {agendas.length === 0 && <tr><td colSpan={8} className="muted">Sin agendas</td></tr>}
          </tbody>
        </table>
      </div>

      {(creando || editando) && (
        /* `key` para que el estado interno se reinicie al pasar de una franja a otra:
           hoy el modal se monta condicionalmente y funcionaría igual, pero es un seguro
           de una línea contra que alguien lo deje siempre montado. */
        <FormAgenda key={editando?.id ?? 'nueva'}
                    agenda={editando} prestadores={prestadores} servicios={servicios}
                    onCerrar={() => { setCreando(false); setEditando(null); }}
                    onGuardado={() => { setCreando(false); setEditando(null); recargar(); }} />
      )}
      {mensual && (
        <ProgramacionMensual prestadores={prestadores} servicios={servicios}
                             onCerrar={() => setMensual(false)}
                             onGuardado={() => { setMensual(false); recargar(); }} />
      )}
      {bloqueando && (
        <ModalBloqueo agenda={bloqueando}
                      onCerrar={() => setBloqueando(null)}
                      onAplicado={() => { setBloqueando(null); recargar(); }} />
      )}
    </div>
  );
}

/**
 * RN-06.6 · El mismo formulario para crear y para corregir.
 *
 * El panel de impacto aparece **dentro de este modal** y no en uno encima, y la razón no
 * es estética: «Volver a editar» conserva lo tecleado. Con un segundo modal, cancelar
 * tira el formulario entero y hay que rehacerlo.
 */
function FormAgenda({ agenda, prestadores, servicios, onCerrar, onGuardado }: {
  agenda: Agenda | null; prestadores: Prestador[]; servicios: Servicio[];
  onCerrar: () => void; onGuardado: () => void;
}) {
  const editando = agenda !== null;
  const [modo, setModo] = useState<'semanal' | 'calendario'>(agenda?.modo ?? 'semanal');
  const [f, setF] = useState({
    prestadorId: agenda?.prestadorId ?? '',
    fecha: agenda?.fecha?.slice(0, 10) ?? hoyIso(),
    horaIni: agenda?.horaIni ?? '08:00',
    horaFin: agenda?.horaFin ?? '12:00',
    slotMin: agenda?.slotMin ?? 15,
    servicioId: agenda?.servicioId ?? '',
    consultorio: agenda?.consultorio ?? '',
  });
  const [dias, setDias] = useState<number[]>(agenda?.diasSemana ?? [1, 2, 3, 4, 5]);
  const [error, setError] = useState('');
  const [impacto, setImpacto] = useState<ResultadoImpacto | null>(null);

  const cuerpo = () => ({
    modo,
    ...(modo === 'semanal' ? { diasSemana: dias } : { fecha: f.fecha }),
    horaIni: f.horaIni, horaFin: f.horaFin, slotMin: Number(f.slotMin),
    servicioId: f.servicioId, consultorio: f.consultorio,
  });

  async function guardar(confirmar = false) {
    setError('');
    try {
      if (!editando) {
        await api.crearAgenda({
          prestadorId: f.prestadorId, modo,
          ...(modo === 'semanal' ? { diasSemana: dias } : { fecha: f.fecha }),
          horaIni: f.horaIni, horaFin: f.horaFin, slotMin: Number(f.slotMin),
          ...(f.servicioId ? { servicioId: f.servicioId } : {}),
          ...(f.consultorio ? { consultorio: f.consultorio } : {}),
        });
        onGuardado();
        return;
      }

      const r = await api.actualizarAgenda(agenda.id, { ...cuerpo(), confirmar });
      /*
       * Un solo clic en el caso normal: si no hay citas afectadas, el servidor ya aplicó
       * el cambio y no hay nada que confirmar. Arreglar el consultorio o ampliar media
       * hora no puede costar dos pasos.
       */
      if (r.simulacion) setImpacto(r);
      else onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function retirar(confirmar = false) {
    if (!agenda) return;
    if (!confirmar && !confirm(
      `¿Retirar la franja ${agenda.horaIni}–${agenda.horaFin}?\n\n`
      + 'Dejará de ofrecer cupos. Se puede volver a activar desde «Ver retiradas».',
    )) return;
    setError('');
    try {
      const r = await api.retirarAgenda(agenda.id, confirmar);
      if (r.simulacion) setImpacto(r);
      else onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>{editando ? 'Editar agenda' : 'Nueva agenda'}</h3>
        {error && <div className="error">{error}</div>}

        <div className="field">
          <label htmlFor="ag-prestador">Prestador</label>
          {/* Al editar no se cambia: mover una franja a otro médico no es corregirla, es
              retirar una y crear otra — y el impacto calculado sería el del otro. */}
          <select id="ag-prestador" value={f.prestadorId} disabled={editando}
                  onChange={(e) => setF({ ...f, prestadorId: e.target.value })}>
            <option value="">Seleccione…</option>
            {prestadores.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.especialidad}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Modo</label>
          <div className="tabs">
            <button className={`tab ${modo === 'semanal' ? 'activa' : ''}`} onClick={() => setModo('semanal')}>
              Semanal recurrente
            </button>
            <button className={`tab ${modo === 'calendario' ? 'activa' : ''}`} onClick={() => setModo('calendario')}>
              Por calendario
            </button>
          </div>
          <span className="p-ayuda">
            Los especialistas suelen atender por fechas puntuales; medicina general, por patrón semanal.
          </span>
        </div>

        {modo === 'semanal' ? (
          <div className="field">
            <label>Días</label>
            <div className="chips-seleccion">
              {DIAS.map((d) => (
                <button key={d.n} type="button"
                        className={`chip-sel ${dias.includes(d.n) ? 'activo' : ''}`}
                        onClick={() => setDias(dias.includes(d.n) ? dias.filter((x) => x !== d.n) : [...dias, d.n])}>
                  {d.e}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="ag-fecha">Fecha</label>
            <input id="ag-fecha" type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} />
          </div>
        )}

        <div className="grid-2">
          <div className="field">
            <label htmlFor="ag-desde">Desde</label>
            <input id="ag-desde" type="time" value={f.horaIni} onChange={(e) => setF({ ...f, horaIni: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="ag-hasta">Hasta</label>
            <input id="ag-hasta" type="time" value={f.horaFin} onChange={(e) => setF({ ...f, horaFin: e.target.value })} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="ag-slot">Fracción de atención (min)</label>
            <input id="ag-slot" type="number" min={5} max={240} step={5} value={f.slotMin}
                   onChange={(e) => setF({ ...f, slotMin: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label htmlFor="ag-consultorio">Consultorio</label>
            <input id="ag-consultorio" value={f.consultorio} onChange={(e) => setF({ ...f, consultorio: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="ag-servicio">Servicio principal (opcional)</label>
          <select id="ag-servicio" value={f.servicioId} onChange={(e) => setF({ ...f, servicioId: e.target.value })}>
            <option value="">Sin especificar</option>
            {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <span className="p-ayuda">
            Es informativo. El prestador puede atender en la misma franja cualquier servicio
            que tenga configurado — así se intercalan consultas y controles.
          </span>
        </div>

        {impacto ? (
          <>
            <div className="error">{impacto.mensaje}</div>
            {impacto.citas.length > 0 && (
              <table className="tabla">
                <thead><tr><th>Código</th><th>Paciente</th><th>Fecha</th><th>Teléfono</th><th></th></tr></thead>
                <tbody>
                  {impacto.citas.map((c) => (
                    <tr key={c.id}>
                      <td><span className="chip">{c.codigo}</span></td>
                      <td>{c.paciente.apellidos}, {c.paciente.nombres}</td>
                      <td>{c.fecha.slice(0, 10)} · {aHora(c.horaInicio)}</td>
                      <td>{c.paciente.telefono ?? '—'}</td>
                      <td>
                        {c.motivo === 'ya_estaba_fuera'
                          && <span className="tag t-gray" title="No la causa este cambio">Ya estaba fuera</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {impacto.truncado && (
              <p className="nota">Se listan las primeras {impacto.citas.length} de {impacto.citasAfectadas}.</p>
            )}
            <div className="acciones">
              <button className="btn btn-danger" onClick={() => void guardar(true)}>
                Guardar de todas formas
              </button>
              {/* Vuelve al formulario CON lo tecleado: por eso el panel vive aquí dentro. */}
              <button className="btn btn-ghost" onClick={() => setImpacto(null)}>Volver a editar</button>
            </div>
          </>
        ) : (
          <>
            <div className="acciones">
              <button className="btn btn-primary" onClick={() => void guardar()} disabled={!f.prestadorId}>
                {editando ? 'Guardar' : 'Crear'}
              </button>
              <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            </div>
            {editando && (
              /* Separado del botón que se pulsa por reflejo: un destructivo pegado a
                 «Guardar» es un accidente esperando. */
              <div className="acciones borde-arriba">
                <button className="btn btn-danger" onClick={() => void retirar()}>Retirar franja</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * RN-06.4 · Programación masiva mensual: se marcan varios días del mes y se les
 * asigna una franja en un solo paso.
 */
function ProgramacionMensual({ prestadores, servicios, onCerrar, onGuardado }: {
  prestadores: Prestador[]; servicios: Servicio[]; onCerrar: () => void; onGuardado: () => void;
}) {
  const hoy = new Date(`${hoyIso()}T12:00:00`);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth());
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [f, setF] = useState({
    prestadorId: '', horaIni: '08:00', horaFin: '12:00', slotMin: 20, servicioId: '', consultorio: '',
  });
  const [reemplazar, setReemplazar] = useState(true);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState('');

  const diasDelMes = new Date(anio, mes + 1, 0).getDate();
  const iso = (d: number) => `${anio}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const primerDiaSemana = (new Date(anio, mes, 1).getDay() + 6) % 7;

  function alternarDia(d: number) {
    const f = iso(d);
    setSeleccion(seleccion.includes(f) ? seleccion.filter((x) => x !== f) : [...seleccion, f]);
  }

  /** Atajo frecuente: "todos los martes del mes". */
  function seleccionarDiaSemana(dow: number) {
    const fechas: string[] = [];
    for (let d = 1; d <= diasDelMes; d++) {
      if (((new Date(anio, mes, d).getDay() + 6) % 7) === dow) fechas.push(iso(d));
    }
    const todosPuestos = fechas.every((x) => seleccion.includes(x));
    setSeleccion(todosPuestos
      ? seleccion.filter((x) => !fechas.includes(x))
      : [...new Set([...seleccion, ...fechas])]);
  }

  async function programar() {
    setError(''); setResultado('');
    try {
      const r = await api.programacionMensual({
        prestadorId: f.prestadorId, fechas: seleccion,
        horaIni: f.horaIni, horaFin: f.horaFin, slotMin: Number(f.slotMin),
        ...(f.servicioId ? { servicioId: f.servicioId } : {}),
        ...(f.consultorio ? { consultorio: f.consultorio } : {}),
        reemplazar,
      });
      setResultado(`${r.programadas} día(s) programado(s).`);
      setSeleccion([]);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const NOMBRE_MES = new Date(anio, mes, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>Programación mensual</h3>
        <p className="nota">
          Marca los días y asígnales una franja en un solo paso. Si algo falla, no se programa
          ningún día: la operación es todo o nada.
        </p>

        {error && <div className="error">{error}</div>}
        {resultado && <div className="exito">{resultado}</div>}

        <div className="field">
          <label>Prestador</label>
          <select value={f.prestadorId} onChange={(e) => setF({ ...f, prestadorId: e.target.value })}>
            <option value="">Seleccione…</option>
            {prestadores.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.especialidad}</option>)}
          </select>
        </div>

        <div className="cal-cab">
          <button className="btn btn-ghost" onClick={() => {
            const m = mes - 1; if (m < 0) { setMes(11); setAnio(anio - 1); } else setMes(m);
          }}>‹</button>
          <strong style={{ textTransform: 'capitalize' }}>{NOMBRE_MES}</strong>
          <button className="btn btn-ghost" onClick={() => {
            const m = mes + 1; if (m > 11) { setMes(0); setAnio(anio + 1); } else setMes(m);
          }}>›</button>
        </div>

        <div className="cal-grid">
          {DIAS.map((d, i) => (
            <button key={d.n} className="cal-dow" onClick={() => seleccionarDiaSemana(i)} title={`Todos los ${d.e}`}>
              {d.e}
            </button>
          ))}
          {Array.from({ length: primerDiaSemana }, (_, i) => <span key={`v${i}`} />)}
          {Array.from({ length: diasDelMes }, (_, i) => i + 1).map((d) => (
            <button key={d}
                    className={`cal-dia ${seleccion.includes(iso(d)) ? 'sel' : ''}`}
                    onClick={() => alternarDia(d)}>
              {d}
            </button>
          ))}
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Desde</label>
            <input type="time" value={f.horaIni} onChange={(e) => setF({ ...f, horaIni: e.target.value })} />
          </div>
          <div className="field">
            <label>Hasta</label>
            <input type="time" value={f.horaFin} onChange={(e) => setF({ ...f, horaFin: e.target.value })} />
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Fracción (min)</label>
            <input type="number" min={5} max={240} step={5} value={f.slotMin}
                   onChange={(e) => setF({ ...f, slotMin: Number(e.target.value) })} />
          </div>
          <div className="field">
            <label>Servicio</label>
            <select value={f.servicioId} onChange={(e) => setF({ ...f, servicioId: e.target.value })}>
              <option value="">Sin especificar</option>
              {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        </div>

        <label className="p-check">
          <input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} />
          Reemplazar la programación existente de esos días
        </label>

        <div className="acciones">
          <button className="btn btn-primary" onClick={programar} disabled={!f.prestadorId || seleccion.length === 0}>
            Programar {seleccion.length} día(s)
          </button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

/**
 * RN-06.3 · Al bloquear disponibilidad con citas asignadas, primero se muestra el
 * impacto. El conflicto lo resuelve la parte administrativa.
 */
function ModalBloqueo({ agenda, onCerrar, onAplicado }: {
  agenda: Agenda; onCerrar: () => void; onAplicado: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [simulacion, setSimulacion] = useState<ResultadoBloqueo | null>(null);
  const [error, setError] = useState('');

  async function simular() {
    setError('');
    try {
      setSimulacion(await api.bloquearAgenda(agenda.id, motivo || 'Sin motivo', false));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function aplicar() {
    setError('');
    try {
      await api.bloquearAgenda(agenda.id, motivo, true);
      onAplicado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>Bloquear disponibilidad</h3>
        <p className="nota">
          {agenda.prestador?.nombre} · {agenda.horaIni}–{agenda.horaFin}
        </p>

        {error && <div className="error">{error}</div>}

        <div className="field">
          <label>Motivo</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
                 placeholder="Ej.: incapacidad médica, viaje, capacitación…" />
        </div>

        {!simulacion ? (
          <div className="acciones">
            <button className="btn btn-primary" onClick={simular} disabled={!motivo.trim()}>
              Ver impacto
            </button>
            <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          </div>
        ) : (
          <>
            <div className={simulacion.citasAfectadas > 0 ? 'error' : 'exito'}>
              {simulacion.mensaje}
            </div>

            {simulacion.citas.length > 0 && (
              <table className="tabla">
                <thead><tr><th>Código</th><th>Paciente</th><th>Fecha</th><th>Teléfono</th></tr></thead>
                <tbody>
                  {simulacion.citas.map((c) => (
                    <tr key={c.id}>
                      <td><span className="chip">{c.codigo}</span></td>
                      <td>{c.paciente.apellidos}, {c.paciente.nombres}</td>
                      <td>{c.fecha.slice(0, 10)}</td>
                      <td>{c.paciente.telefono ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="nota">
              Al confirmar, la agenda queda bloqueada y estas citas requieren reprogramación.
              La notificación al paciente sale por WhatsApp.
            </p>

            <div className="acciones">
              <button className="btn btn-primary" onClick={aplicar}>Confirmar bloqueo</button>
              <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
