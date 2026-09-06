import { useEffect, useState } from 'react';
import {
  CONFIG, diaSemanaIso, fechasDeVentana, hoyEnSede, parsearDias, parsearVentana,
  serializarVentana, ventanaPara, type FilaVentana,
} from '@provivir/shared';
import { api } from '../api';

/**
 * RN-04.8 · Cuándo está abierto el autoagendamiento.
 *
 * Son cinco filas de la tabla clave/valor de Administración → Reglas, donde se veían
 * como texto crudo —`1:3-5,2:4-5,…`— que nadie puede editar sin equivocarse. Aquí se
 * editan con desplegables y casillas, y sobre todo **se ve el resultado**: siete filas
 * de días no dicen qué va a pasar hoy.
 *
 * Las reglas no se reimplementan: se importa el MISMO módulo que aplica el motor
 * (`@provivir/shared/autoagendamiento`). Es la única forma de que lo que muestra esta
 * pantalla y lo que hace el servidor no se separen con el tiempo.
 *
 * Esto solo gobierna la CREACIÓN de citas por autoservicio. Cancelar y reprogramar
 * siguen siempre activos, y el mostrador no se ve afectado por nada de aquí.
 */

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const nombreDia = (iso: number): string => DIAS[iso - 1] ?? '?';

/** `12:00-23:59` ↔ los dos `<input type="time">`. */
function partirFranja(valor: string): [string, string] {
  const [a, b] = valor.split('-');
  return [(a ?? '').trim(), (b ?? '').trim()];
}

const fechaLarga = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

export function Autoagendamiento() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [filas, setFilas] = useState<FilaVentana[]>([]);
  const [excluidos, setExcluidos] = useState<number[]>([]);
  const [cita, setCita] = useState<[string, string]>(['', '']);
  const [canal, setCanal] = useState<[string, string]>(['', '']);
  const [cerradas, setCerradas] = useState<Set<string>>(new Set());
  const [hoyEsFestivo, setHoyEsFestivo] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  /*
   * Se relee entero al cargar y después de cada guardado, como hace `ModalTemas`: si
   * otra persona cambió una fila mientras esta estaba abierta, guardar la tabla la
   * pisaría entera —es una sola clave— y al menos hay que volver a mostrar la verdad.
   */
  function recargar() {
    api.configuracion()
      .then((c) => {
        setConfig(c);
        setFilas(parsearVentana(c[CONFIG.AUTOAGENDAMIENTO_VENTANA_DIAS]));
        setExcluidos(parsearDias(c[CONFIG.AUTOAGENDAMIENTO_DIAS_EXCLUIDOS], []));
        setCita(partirFranja(c[CONFIG.AUTOAGENDAMIENTO_HORARIO_CITA] ?? ''));
        setCanal(partirFranja(c[CONFIG.AUTOAGENDAMIENTO_HORARIO_CANAL] ?? ''));
      })
      .catch((e: Error) => setError(e.message));
  }
  useEffect(recargar, []);

  /*
   * Los días cerrados de este año y del siguiente: la ventana puede tener seis días de
   * ancho y cruzar el 31 de diciembre, y una vista previa que ofrezca el 1 de enero
   * cuando el motor no lo ofrece es peor que no tener vista previa.
   */
  useEffect(() => {
    const anio = hoyEnSede().getUTCFullYear();
    const hoyIso = hoyEnSede().toISOString().slice(0, 10);
    Promise.all([api.diasNoLaborables(anio), api.diasNoLaborables(anio + 1)])
      .then(([a, b]) => {
        const fechas = [...a, ...b].map((d) => d.fecha.slice(0, 10));
        setCerradas(new Set(fechas));
        setHoyEsFestivo(fechas.includes(hoyIso));
      })
      .catch(() => undefined);
  }, []);

  async function guardar(clave: string, valor: string) {
    setError(''); setAviso('');
    try {
      await api.fijarConfiguracion(clave, valor);
      setAviso('Regla actualizada. El cambio queda en auditoría.');
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const activa = config[CONFIG.AUTOAGENDAMIENTO_VENTANA_ACTIVA] === 'true';
  const tablaGuardada = config[CONFIG.AUTOAGENDAMIENTO_VENTANA_DIAS] ?? '';
  const excluidosGuardados = config[CONFIG.AUTOAGENDAMIENTO_DIAS_EXCLUIDOS] ?? '';

  // La vista previa se calcula sobre lo que hay EN PANTALLA, no sobre lo guardado: sirve
  // para decidir antes de guardar. Debajo se avisa cuando las dos cosas no coinciden.
  const hoy = hoyEnSede();
  const previa = filas.length
    ? fechasDeVentana(ventanaPara(hoy, filas, hoyEsFestivo), excluidos, cerradas)
    : [];
  const sinGuardar = serializarVentana(filas) !== tablaGuardada
    || excluidos.join(',') !== excluidosGuardados.trim();

  function cambiarFila(dia: number, campo: 'desde' | 'hasta', valor: number) {
    setFilas(filas.map((f) => (f.dia === dia ? { ...f, [campo]: valor } : f)));
  }

  function alternarExcluido(dia: number) {
    setExcluidos(excluidos.includes(dia)
      ? excluidos.filter((d) => d !== dia)
      : [...excluidos, dia].sort((a, b) => a - b));
  }

  return (
    <div className="vista">
      {error && <div className="error">{error}</div>}
      {aviso && <div className="exito">{aviso}</div>}

      <div className="card plano" style={{ marginBottom: '1rem' }}>
        <div className="hd">
          <h3>Restricción de días</h3>
          <div className="spacer" />
          <span className={`tag ${activa ? 't-green' : 't-gray'}`}>{activa ? 'Activa' : 'Apagada'}</span>
        </div>
        <div className="bd">
          <label htmlFor="aa-activa" style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}>
            <input
              id="aa-activa"
              type="checkbox"
              checked={activa}
              onChange={(e) => guardar(CONFIG.AUTOAGENDAMIENTO_VENTANA_ACTIVA, String(e.target.checked))}
            />
            Limitar qué días puede reservar quien se agenda solo
          </label>
          <p className="small muted" style={{ marginTop: '.6rem' }}>
            Apagarlo <b>no</b> apaga el autoagendamiento: lo deja sin restricción de días, como
            antes. Los horarios de más abajo también dejan de aplicarse. Cancelar y reprogramar
            no dependen de esto: están siempre activos, y el mostrador agenda cualquier día.
          </p>
        </div>
      </div>

      <div className="grid g2">
        <div className="card plano">
          <div className="hd"><h3>Qué días se pueden reservar</h3></div>
          <div className="bd">
            <p className="small muted" style={{ marginBottom: '.8rem' }}>
              Según el día en que el paciente agenda. El primer día ofrecido es siempre
              posterior a hoy.
            </p>
            <table className="tabla">
              <thead>
                <tr><th>Si agenda un…</th><th>Desde</th><th>Hasta</th></tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.dia}>
                    <td>
                      {nombreDia(f.dia)}
                      {f.dia === 7 && <span className="small muted"> y festivos</span>}
                    </td>
                    {(['desde', 'hasta'] as const).map((campo) => (
                      <td key={campo}>
                        <select
                          aria-label={`${campo === 'desde' ? 'Desde' : 'Hasta'} · si agenda un ${nombreDia(f.dia)}`}
                          value={f[campo]}
                          onChange={(e) => cambiarFila(f.dia, campo, Number(e.target.value))}
                        >
                          {DIAS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                        </select>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn btn-soft btn-sm"
              style={{ marginTop: '.8rem' }}
              disabled={serializarVentana(filas) === tablaGuardada}
              onClick={() => guardar(CONFIG.AUTOAGENDAMIENTO_VENTANA_DIAS, serializarVentana(filas))}
            >
              Guardar la tabla
            </button>
          </div>
        </div>

        <div className="card plano">
          <div className="hd"><h3>Días que no se ofrecen nunca</h3></div>
          <div className="bd">
            <p className="small muted" style={{ marginBottom: '.8rem' }}>
              Se descuentan aunque la ventana los incluya. La clínica sí atiende sábados: se
              reservan para el mostrador.
            </p>
            {DIAS.map((d, i) => (
              <label key={d} htmlFor={`aa-ex-${i + 1}`} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginBottom: '.35rem' }}>
                <input
                  id={`aa-ex-${i + 1}`}
                  type="checkbox"
                  checked={excluidos.includes(i + 1)}
                  onChange={() => alternarExcluido(i + 1)}
                />
                {d}
              </label>
            ))}
            <button
              className="btn btn-soft btn-sm"
              style={{ marginTop: '.8rem' }}
              disabled={excluidos.join(',') === excluidosGuardados.trim()}
              onClick={() => guardar(CONFIG.AUTOAGENDAMIENTO_DIAS_EXCLUIDOS, excluidos.join(','))}
            >
              Guardar los días excluidos
            </button>
          </div>
        </div>

        <div className="card plano" style={{ gridColumn: '1 / -1' }}>
          <div className="hd"><h3>Resultado de hoy</h3></div>
          <div className="bd">
            {/*
              * Sin esto, siete desplegables no dicen qué va a pasar. Es la vista previa de
              * lo que hay en pantalla, así que se avisa cuando aún no está guardado.
              */}
            <p>
              Hoy es <b>{nombreDia(diaSemanaIso(hoy))}</b>
              {hoyEsFestivo && ' (festivo)'}.{' '}
              {!activa
                ? 'La restricción está apagada: se puede reservar cualquier día a partir de mañana.'
                : previa.length === 0
                  ? 'Con estas reglas hoy no se puede reservar ningún día por autoservicio.'
                  : `Se puede reservar el ${previa.map(fechaLarga).join(', ')}.`}
            </p>
            {sinGuardar && (
              <p className="nota" style={{ marginTop: '.6rem' }}>
                Es la vista previa de los cambios que aún no has guardado.
              </p>
            )}
          </div>
        </div>

        <div className="card plano" style={{ gridColumn: '1 / -1' }}>
          <div className="hd"><h3>Horarios</h3></div>
          <div className="bd">
            <Rango
              id="cita"
              etiqueta="Horas de las citas que se pueden agendar solo"
              ayuda="Solo se ofrecen cupos que empiecen dentro de esta franja. Ojo: hoy 14 de las 27 franjas configuradas son solo de mañana, así que una franja de tardes deja fuera más de la mitad de la clínica."
              valor={cita}
              guardado={config[CONFIG.AUTOAGENDAMIENTO_HORARIO_CITA] ?? ''}
              onChange={setCita}
              onGuardar={(v) => guardar(CONFIG.AUTOAGENDAMIENTO_HORARIO_CITA, v)}
            />
            <Rango
              id="canal"
              etiqueta="Horas del día en que el portal y el bot aceptan agendar"
              ayuda="Por reloj de la sede. Fuera de esta franja piden llamar a la clínica. No afecta a consultar, cancelar ni reprogramar."
              valor={canal}
              guardado={config[CONFIG.AUTOAGENDAMIENTO_HORARIO_CANAL] ?? ''}
              onChange={setCanal}
              onGuardar={(v) => guardar(CONFIG.AUTOAGENDAMIENTO_HORARIO_CANAL, v)}
            />
            <p className="nota" style={{ marginTop: '.6rem' }}>
              La <b>anticipación mínima</b> ({config['agendamiento_anticipacion_dias'] ?? '?'} día[s],
              en Reglas) se sigue aplicando además de todo esto. Con la tabla de arriba nunca
              llega a morder, porque la ventana empieza como pronto pasado mañana.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Rango({ id, etiqueta, ayuda, valor, guardado, onChange, onGuardar }: {
  id: string; etiqueta: string; ayuda: string;
  valor: [string, string]; guardado: string;
  onChange: (v: [string, string]) => void;
  onGuardar: (v: string) => void;
}) {
  const serializado = `${valor[0]}-${valor[1]}`;
  return (
    <div className="field" style={{ marginBottom: '1rem' }}>
      <label htmlFor={`aa-${id}-desde`}>{etiqueta}</label>
      <div className="searchbar">
        <input id={`aa-${id}-desde`} type="time" value={valor[0]}
               onChange={(e) => onChange([e.target.value, valor[1]])} />
        <span className="small muted">a</span>
        <input id={`aa-${id}-hasta`} type="time" aria-label={`Hasta · ${etiqueta}`} value={valor[1]}
               onChange={(e) => onChange([valor[0], e.target.value])} />
        <button
          className="btn btn-soft btn-sm"
          aria-label={`Guardar · ${etiqueta}`}
          disabled={serializado === guardado || !valor[0] || !valor[1]}
          onClick={() => onGuardar(serializado)}
        >
          Guardar
        </button>
      </div>
      <span className="small muted">{ayuda}</span>
    </div>
  );
}
