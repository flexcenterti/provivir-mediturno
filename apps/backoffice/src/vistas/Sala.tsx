import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type Turno, type UsuarioSesion } from '../api';
import { ModalPriorizar, TablaCola, VistaPrestador } from './Prestador';

/**
 * Un punto de entrada, dos oficios.
 *
 * El médico abre su cola y llama; la asistente necesita lo contrario: ver la sala
 * entera y elegir de quién llamar. Antes esta pantalla resolvía la cola por
 * `usuario.prestadorId`, y una asistente **nunca puede tenerlo** —ese vínculo está
 * reservado a rol=prestador y es uno a uno con una ficha (RN-06.2)—, así que le salía
 * un aviso y nada más.
 *
 * El backend ya lo soportaba entero: `llamar-siguiente` recibe el prestador en el
 * cuerpo y no lo contrasta con quien pulsa, y el catálogo de permisos dice que
 * `turnos.atender` «lo usan asistentes y médicos». Solo faltaba quién elige la cola.
 */
export function VistaSala({ usuario }: { usuario: UsuarioSesion }) {
  if (usuario.prestadorId) return <VistaPrestador prestadorId={usuario.prestadorId} />;

  /*
   * Una cuenta de médico sin ficha no ve la sala: el backend tampoco se la daría
   * —le devuelve la cola vacía— y darle la de todos sería justo lo que se acaba de
   * cerrar. Lo que necesita es que administración le ate su ficha.
   */
  if (usuario.rol === 'prestador') {
    return (
      <p className="nota">
        Esta cuenta es de profesional pero no está asociada a ninguna ficha, así que no
        tiene una cola propia que mostrar. Administración puede asociarla desde
        Administración → Acceso.
      </p>
    );
  }

  return <Sala />;
}

/** La sala completa, con el detalle de una cola cuando se elige profesional. */
function Sala() {
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [seleccion, setSeleccion] = useState('');
  const [priorizando, setPriorizando] = useState<Turno | null>(null);
  const [error, setError] = useState('');

  const recargar = useCallback(() => {
    // Sin prestador, el motor devuelve la sala completa. Es la foto que hace falta
    // en el mostrador: cuánta gente hay y con quién, no una cola cada vez.
    api.cola().then(setTurnos).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    recargar();
    // El tiempo esperando avanza aunque no pase nada.
    const id = setInterval(recargar, 15_000);
    return () => clearInterval(id);
  }, [recargar]);

  /*
   * Los profesionales salen de la propia cola, no del catálogo: en la sala solo
   * tiene sentido abrir la cola de quien tiene gente esperando. De los 21 del
   * catálogo, un día normal tendrán cola cuatro o cinco.
   */
  const conCola = useMemo(() => {
    const porId = new Map<string, { id: string; nombre: string; esperando: number }>();
    for (const t of turnos) {
      const { id, nombre } = t.cita.prestador;
      const previo = porId.get(id);
      porId.set(id, { id, nombre, esperando: (previo?.esperando ?? 0) + 1 });
    }
    return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [turnos]);

  if (seleccion) {
    const elegido = conCola.find((p) => p.id === seleccion);
    return (
      <>
        <div className="controles">
          <button className="btn btn-ghost" onClick={() => { setSeleccion(''); recargar(); }}>
            ← Volver a la sala
          </button>
          <strong>{elegido?.nombre ?? 'Profesional'}</strong>
        </div>
        {/* `key` fuerza el remontaje: si no, el intervalo arrastraría la cola
            anterior un ciclo y se vería la de otro médico durante 15 s. */}
        <VistaPrestador key={seleccion} prestadorId={seleccion} />
      </>
    );
  }

  return (
    <div className="vista">
      {error && <div className="error">{error}</div>}

      <div className="controles">
        <select value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
          <option value="">— Toda la sala —</option>
          {conCola.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre} · {p.esperando} esperando</option>
          ))}
        </select>
        <span className="muted">
          {turnos.length === 0
            ? 'Nadie en sala'
            : `${turnos.length} paciente(s) · ${conCola.length} profesional(es)`}
        </span>
      </div>

      <div className="card">
        <h3>En sala ahora</h3>
        <TablaCola turnos={turnos} conProfesional onFila={setPriorizando} />
        <p className="nota">
          {/* Explica por qué no hay un botón de llamar aquí: no es un olvido. */}
          El llamado es siempre al siguiente de la cola de un profesional, así que elija
          uno arriba para llamar. Desde aquí puede adelantar a un paciente tocándolo y
          dejando la nota del motivo.
        </p>
      </div>

      {priorizando && (
        <ModalPriorizar
          turno={priorizando}
          onCerrar={() => setPriorizando(null)}
          onListo={() => { setPriorizando(null); recargar(); }}
        />
      )}
    </div>
  );
}
