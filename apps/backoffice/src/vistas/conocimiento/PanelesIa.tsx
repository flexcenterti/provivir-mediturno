import { useState } from 'react';
import { api, type ResumenConocimiento } from '../../api';
import { enHoras } from './cta';

/**
 * Los tres parámetros que gobiernan lo que el bot responde, editables donde se
 * ven sus consecuencias.
 *
 * Están aquí y no solo en Administración → Reglas porque calibrar el umbral sin
 * el probador al lado es adivinar: se cambia el número, se prueba una pregunta y
 * se ve si escala o responde.
 */

const DESCRIPCION_PASO: Record<string, string> = {
  seguimiento_1: 'Pregunta abierta con un beneficio aún no mencionado',
  seguimiento_2: 'Algo nuevo y concreto: horarios reales o la barrera detectada',
  cierre: 'Cierre cordial, sin pregunta y sin volver a insistir',
};

const ETIQUETA_PASO: Record<string, string> = {
  seguimiento_1: 'Seguimiento 1',
  seguimiento_2: 'Seguimiento 2',
  cierre: 'Cierre',
};

export function PanelesIa({ resumen, editable, onAccion, onIrABandeja }: {
  resumen: ResumenConocimiento;
  editable: boolean;
  onAccion: (fn: () => Promise<string | void>, exito?: string) => void;
  onIrABandeja: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <ParametrosIa p={resumen.parametros} editable={editable} onAccion={onAccion} />
      <TemasProhibidos temas={resumen.parametros.temas} editable={editable} onAccion={onAccion} />
      <SeguimientoComercial
        seguimiento={resumen.parametros.seguimiento}
        activos={resumen.seguimientosActivos}
        editable={editable}
        onAccion={onAccion}
        onIrABandeja={onIrABandeja}
      />
    </div>
  );
}

function ParametrosIa({ p, editable, onAccion }: {
  p: ResumenConocimiento['parametros'];
  editable: boolean;
  onAccion: (fn: () => Promise<string | void>, exito?: string) => void;
}) {
  const [umbral, setUmbral] = useState(String(p.umbral));
  const [topK, setTopK] = useState(String(p.topK));

  const sucio = umbral !== String(p.umbral) || topK !== String(p.topK);

  return (
    <div className="card plano">
      <div className="hd"><h3>Parámetros de la IA</h3></div>
      <div className="bd">
        <div className="kb-row">
          <span className="muted">Umbral de confianza</span>
          {editable
            ? <input type="number" min={0} max={100} value={umbral} aria-label="Umbral de confianza"
                     onChange={(e) => setUmbral(e.target.value)} />
            : <b>{p.umbral}</b>}
        </div>
        <div className="kb-row">
          <span className="muted">Fragmentos por consulta</span>
          {editable
            ? <input type="number" min={1} max={10} value={topK} aria-label="Fragmentos por consulta"
                     onChange={(e) => setTopK(e.target.value)} />
            : <b>{p.topK}</b>}
        </div>

        {/* No son parámetros: son invariantes de RN-13. No se ofrecen para editar
            porque no hay forma legítima de apagarlos desde una pantalla. */}
        <div className="kb-row"><span className="muted">Sin cobertura</span><b>Escala, no responde</b></div>
        <div className="kb-row"><span className="muted">Origen de las cifras</span><b>Ficha del servicio</b></div>

        {editable && sucio && (
          <div className="acciones">
            <button className="btn btn-soft btn-sm" onClick={() => onAccion(async () => {
              await api.fijarConfiguracion('kb_score_min', String(Number(umbral)));
              await api.fijarConfiguracion('kb_top_k', String(Number(topK)));
              return `Umbral ${umbral} · ${topK} fragmentos por consulta. Prueba una pregunta para ver el efecto.`;
            })}>
              Guardar
            </button>
          </div>
        )}

        <p className="small muted" style={{ marginTop: '.6rem' }}>
          En el piloto se arranca conservador: es preferible escalar de más a responder de más.
        </p>
      </div>
    </div>
  );
}

function TemasProhibidos({ temas, editable, onAccion }: {
  temas: string[];
  editable: boolean;
  onAccion: (fn: () => Promise<string | void>, exito?: string) => void;
}) {
  const [editando, setEditando] = useState(false);

  return (
    <div className="card plano">
      <div className="hd">
        <h3>Temas que escalan siempre</h3>
        <div className="spacer" />
        <span className="tag t-red">P12</span>
      </div>
      <div className="bd">
        <div className="chips">
          {temas.map((t) => <span key={t} className="tag t-red" style={{ fontSize: '.8rem' }}>{t}</span>)}
        </div>

        {editable && (
          <div className="acciones">
            <button className="btn btn-ghost btn-sm" onClick={() => setEditando(true)}>✏️ Editar temas</button>
          </div>
        )}

        <p className="small muted" style={{ marginTop: '.7rem' }}>
          Ignoran el puntaje: aunque exista un artículo que cubra el tema, la conversación pasa a
          una persona (RN-13.4).
        </p>

        <div className="small" style={{
          marginTop: '.7rem', padding: '.6rem', background: 'var(--red-soft)',
          borderRadius: '8px', color: '#93321F',
        }}>
          🚑 <b>Señales de emergencia:</b> no van a la bandeja. El bot entrega de inmediato el texto
          de derivación a la línea de emergencias externa —<code>ia.prompt.ts · DERIVAR_EMERGENCIA</code>—
          porque la clínica no presta urgencias y dejar a esa persona en cola sería el peor
          resultado posible.
        </div>
      </div>

      {editando && <ModalTemas onCerrar={() => setEditando(false)} onAccion={onAccion} />}
    </div>
  );
}

interface TemaEditable { tema: string; senales: string }

/**
 * La lista completa vive en `kb_temas_prohibidos`, que hasta ahora no existía como
 * fila de configuración y además no cabía en el tope de 200 caracteres del API.
 * Se relee entera al abrir para no escribir encima de lo que haya cambiado otro.
 */
function ModalTemas({ onCerrar, onAccion }: {
  onCerrar: () => void;
  onAccion: (fn: () => Promise<string | void>, exito?: string) => void;
}) {
  const [temas, setTemas] = useState<TemaEditable[] | null>(null);
  const [error, setError] = useState('');

  if (temas === null) {
    void api.configuracion()
      .then((c) => {
        const crudo = c['kb_temas_prohibidos'] ?? '[]';
        const lista = JSON.parse(crudo) as Array<{ tema: string; senales: string[] }>;
        setTemas(lista.map((t) => ({ tema: t.tema, senales: (t.senales ?? []).join('\n') })));
      })
      .catch(() => setTemas([]));
  }

  const guardar = () => {
    const lista = (temas ?? [])
      .map((t) => ({ tema: t.tema.trim(), senales: t.senales.split('\n').map((s) => s.trim()).filter(Boolean) }))
      .filter((t) => t.tema && t.senales.length);

    if (lista.length === 0) {
      setError('Deja al menos un tema con una señal: una lista vacía dejaría al bot sin guardarraíl clínico.');
      return;
    }
    onCerrar();
    onAccion(async () => {
      await api.fijarConfiguracion('kb_temas_prohibidos', JSON.stringify(lista));
      return `${lista.length} tema(s) de escalamiento obligatorio guardados (P12).`;
    });
  };

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>Temas que escalan siempre</h3>
        {error && <div className="error" role="alert">{error}</div>}

        <p className="nota">
          Cada tema escala aunque la base tenga con qué responder. Las señales se comparan en
          minúscula y sin tildes contra el mensaje del paciente. La lista definitiva la aprueba el
          cliente por escrito (P12).
        </p>

        {temas === null ? <p className="nota">Cargando…</p> : temas.map((t, i) => (
          <div key={i} className="panel-interno">
            <div className="panel-cab">
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor={`tema-${i}`}>Tema</label>
                <input id={`tema-${i}`} value={t.tema}
                       onChange={(e) => setTemas(temas.map((x, j) => j === i ? { ...x, tema: e.target.value } : x))} />
              </div>
              <button className="btn btn-ghost btn-sm"
                      onClick={() => setTemas(temas.filter((_, j) => j !== i))}>Quitar</button>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`senales-${i}`}>Señales · una por línea</label>
              <textarea id={`senales-${i}`} rows={3} value={t.senales}
                        onChange={(e) => setTemas(temas.map((x, j) => j === i ? { ...x, senales: e.target.value } : x))} />
            </div>
          </div>
        ))}

        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar}>Guardar temas</button>
          <button className="btn btn-soft" onClick={() => setTemas([...(temas ?? []), { tema: '', senales: '' }])}>
            + Añadir tema
          </button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function SeguimientoComercial({ seguimiento, activos, editable, onAccion, onIrABandeja }: {
  seguimiento: ResumenConocimiento['parametros']['seguimiento'];
  activos: number;
  editable: boolean;
  onAccion: (fn: () => Promise<string | void>, exito?: string) => void;
  onIrABandeja: () => void;
}) {
  const inicial = Object.fromEntries(seguimiento.pasos.map((p) => [p.paso, String(p.minutos)]));
  const [min, setMin] = useState<Record<string, string>>(inicial);
  const [error, setError] = useState('');

  const sucio = seguimiento.pasos.some((p) => min[p.paso] !== String(p.minutos));

  const guardar = () => {
    const n = (k: string) => Number(min[k]);
    // RN-09.9.6 · si no cabe en la ventana de 24 h el mensaje solo saldría como
    // plantilla aprobada, y no hay ninguna: se avisa antes de guardarlo.
    if (!(n('seguimiento_1') > 0 && n('seguimiento_1') < n('seguimiento_2')
          && n('seguimiento_2') < n('cierre') && n('cierre') <= 1440)) {
      setError('Los pasos tienen que ir en orden y toda la secuencia caber en la ventana de 24 h de WhatsApp (RN-09.9.6).');
      return;
    }
    setError('');
    onAccion(async () => {
      await api.fijarConfiguracion('seguimiento_retraso_1_min', String(n('seguimiento_1')));
      await api.fijarConfiguracion('seguimiento_retraso_2_min', String(n('seguimiento_2')));
      await api.fijarConfiguracion('seguimiento_retraso_cierre_min', String(n('cierre')));
      return 'Cadencia del seguimiento guardada. Aplica a las secuencias que se armen desde ahora.';
    });
  };

  return (
    <div className="card plano">
      <div className="hd">
        <h3>Seguimiento comercial</h3>
        <div className="spacer" />
        <span className="tag t-blue">RN-09.9</span>
        {!seguimiento.activo && <span className="tag t-gray">Apagado</span>}
      </div>
      <div className="bd">
        {error && <div className="error" role="alert">{error}</div>}

        <p className="small muted" style={{ marginBottom: '.6rem' }}>
          Cuando el bot ofrece la cita y el paciente no la toma, se arma esta secuencia desde el
          último mensaje de la conversación:
        </p>

        {seguimiento.pasos.map((p) => (
          <div key={p.paso} className="kb-row">
            <span className="muted">
              {ETIQUETA_PASO[p.paso] ?? p.paso}
              {editable
                ? ' · +'
                : ` · +${enHoras(p.minutos)}`}
              {editable && (
                <input type="number" min={1} max={1440} value={min[p.paso] ?? ''}
                       aria-label={`Minutos de ${ETIQUETA_PASO[p.paso] ?? p.paso}`}
                       style={{ width: '72px', marginLeft: '.3rem' }}
                       onChange={(e) => setMin({ ...min, [p.paso]: e.target.value })} />
              )}
              {editable && <span className="small"> min</span>}
            </span>
            <b className="small" style={{ textAlign: 'right', maxWidth: '58%' }}>
              {DESCRIPCION_PASO[p.paso] ?? ''}
            </b>
          </div>
        ))}

        {editable && sucio && (
          <div className="acciones">
            <button className="btn btn-soft btn-sm" onClick={guardar}>Guardar cadencia</button>
          </div>
        )}

        <p className="small muted" style={{ marginTop: '.7rem' }}>
          Se detiene sola si el paciente responde, agenda por cualquier canal o pide no ser
          contactado. Solo envía dentro del horario de atención ({seguimiento.horaApertura}:00–
          {seguimiento.horaCierre}:00) y toda la secuencia cabe en la ventana de 24 h de WhatsApp.
        </p>

        <button className="btn btn-soft btn-sm btn-block" style={{ marginTop: '.9rem' }}
                onClick={onIrABandeja}>
          📥 Ver interesados en la bandeja ({activos} activos)
        </button>
      </div>
    </div>
  );
}
