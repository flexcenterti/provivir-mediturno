import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * RN-05 · Reglas de prioridad. D6 · «prioridad», nunca «urgencia».
 *
 * Los parámetros de llegada eran filas crudas de la tabla clave/valor de
 * Administración → Reglas; aquí tienen nombre en lenguaje llano.
 *
 * Los NIVELES, en cambio, son de solo lectura a propósito: los criterios de
 * alta/media/baja siguen pendientes de Grupo Provivir (P4, anotado en el propio
 * `schema.prisma`). Lo que se describe abajo es el motor que corre hoy
 * —`turnos.reglas.ts`—, no una escalera inventada.
 */
const PARAMETROS: Array<{ clave: string; etiqueta: string; ayuda: string }> = [
  {
    clave: 'anticipacion_llegada_min',
    etiqueta: 'Minutos de llegada anticipada admitidos',
    ayuda: 'Con cuánta antelación se puede registrar la llegada de un paciente.',
  },
  {
    clave: 'tolerancia_retraso_min',
    etiqueta: 'Margen de tolerancia para llegar a tiempo (min)',
    ayuda: 'Pasado el margen, la llegada cuenta como tarde y la prioridad en cola baja.',
  },
  {
    clave: 'hueco_max_min',
    etiqueta: 'Hueco máximo entre citas del mismo prestador (min)',
    ayuda: 'RN-03.2 · 0 compacta la agenda al máximo al recomendar cupos.',
  },
];

export function Prioridad() {
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
      setAviso('Regla actualizada. El cambio queda en auditoría.');
      setEditado(Object.fromEntries(Object.entries(editado).filter(([k]) => k !== clave)));
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="vista">
      {error && <div className="error">{error}</div>}
      {aviso && <div className="exito">{aviso}</div>}

      <div className="grid g2">
        <div className="card plano">
          <div className="hd"><h3>Parámetros de llegada y agenda</h3></div>
          <div className="bd">
            {PARAMETROS.map((p) => (
              <div className="field" key={p.clave} style={{ marginBottom: '.9rem' }}>
                <label htmlFor={`p-${p.clave}`}>{p.etiqueta}</label>
                <div className="searchbar">
                  <input
                    id={`p-${p.clave}`}
                    type="number"
                    min={0}
                    value={editado[p.clave] ?? config[p.clave] ?? ''}
                    onChange={(e) => setEditado({ ...editado, [p.clave]: e.target.value })}
                  />
                  {/* Tres botones «Guardar» idénticos no se distinguen ni con lector
                      de pantalla ni con el teclado: cada uno dice qué guarda. */}
                  <button
                    className="btn btn-soft btn-sm"
                    aria-label={`Guardar · ${p.etiqueta}`}
                    disabled={editado[p.clave] === undefined || editado[p.clave] === config[p.clave]}
                    onClick={() => guardar(p.clave)}
                  >
                    Guardar
                  </button>
                </div>
                <span className="small muted">{p.ayuda}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card plano">
          <div className="hd"><h3>Niveles de prioridad en cola</h3></div>
          <div className="bd">
            <div className="kb-row">
              <span><span className="tag t-red">Alta</span></span>
              <span className="small muted right">
                Solo por marcación manual del prestador o la asistente, con nota obligatoria del
                motivo (RN-07.4).
              </span>
            </div>
            <div className="kb-row">
              <span><span className="tag t-amber">Media</span></span>
              <span className="small muted right">
                El paciente tiene alguna condición preferencial registrada en su ficha.
              </span>
            </div>
            <div className="kb-row">
              <span><span className="tag t-gray">Baja</span></span>
              <span className="small muted right">El resto de la cola.</span>
            </div>
            <p className="nota" style={{ marginTop: '.9rem' }}>
              Dentro de un mismo nivel el desempate es: primero quien tiene condiciones
              registradas, y después la hora de llegada. Es lo que hace el motor hoy.
            </p>
          </div>
        </div>

        <div className="card plano" style={{ gridColumn: '1 / -1' }}>
          <div className="hd">
            <h3>Prioridad de casos y conversaciones</h3>
            <div className="spacer" />
            <span className="tag t-amber">Pendiente del cliente (P4)</span>
          </div>
          <div className="bd small">
            Los criterios para clasificar los casos escalados en <b>alta / media / baja</b>
            —por ejemplo dolor, menor de edad o una condición particular del paciente— están
            pendientes de definición por Grupo Provivir. Mientras se definen, el indicador
            operativo principal de la bandeja es el <b>tiempo de espera</b> de cada conversación.
            Por eso esta tarjeta describe el comportamiento actual en vez de ofrecer criterios
            configurables: modelarlos ahora sería adivinar.
            <p className="nota" style={{ marginTop: '.8rem' }}>
              En toda la plataforma se usa el término <b>«prioridad»</b> — nunca «urgencia», que
              corresponde a un servicio habilitado que la clínica no presta (D6).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
