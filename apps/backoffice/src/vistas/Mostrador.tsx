import { useState } from 'react';
import { api, aHora, hoyIso, type Cita, type Cobro, type Turno } from '../api';
import { ModalCita } from './ModalCita';

/**
 * Especificación §2.10 · Mostrador: canal principal de llegada.
 * RN-07.1 · el paciente paga en recepción y aquí se registra la llegada.
 *
 * Se busca antes de registrar. Antes era un solo campo a ciegas con una heurística
 * —«si son solo dígitos es un documento»— que dejaba fuera buscar por nombre o por
 * teléfono, y si el paciente tenía dos citas hoy el motor elegía la más temprana sin
 * decírselo a nadie. Ahora la recepcionista ve a quién va a registrar.
 */
export function Mostrador() {
  const [q, setQ] = useState('');
  const [citas, setCitas] = useState<Cita[] | null>(null);
  const [turno, setTurno] = useState<Turno | null>(null);
  const [viendo, setViendo] = useState<Cita | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const hoy = hoyIso();

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setTurno(null); setCitas(null);
    if (q.trim().length < 3) { setError('Escribe al menos 3 caracteres'); return; }

    setOcupado(true);
    try {
      setCitas(await repetirBusqueda());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setOcupado(false);
    }
  }

  /** Solo las de hoy: con las de cualquier fecha hay que buscar la buena con el
   *  paciente esperando delante. Se reutiliza al volver del modal de la cita. */
  async function repetirBusqueda(): Promise<Cita[]> {
    const r = await api.buscarCitas(q.trim(), { desde: hoy, hasta: hoy });
    setCitas(r);
    return r;
  }

  async function registrar(cita: Cita, cobro: Cobro, cobroNota?: string) {
    setError(''); setOcupado(true);
    try {
      // Con el código exacto: se acabó que el motor elija por su cuenta.
      setTurno(await api.registrarLlegada({ codigo: cita.codigo, cobro, cobroNota }));
      setCitas(null);
      setQ('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setOcupado(false);
    }
  }

  /** El ticket se rearma desde la cita: `GET /citas/:id` ya trae su turno. */
  async function reimprimir(cita: Cita) {
    setError(''); setOcupado(true);
    try {
      const c = await api.cita(cita.id);
      if (!c.turno) { setError('Esta cita no tiene llegada registrada'); return; }
      setTurno({ ...c.turno, cita: c });
      setCitas(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="vista sin-imprimir">
      <p className="nota">Canal principal de llegada. El paciente paga en recepción y aquí se registra su llegada.</p>

      <form className="buscador" onSubmit={buscar}>
        <input
          placeholder="Código, documento, nombre o teléfono…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        <button className="btn btn-primary" type="submit" disabled={ocupado}>Buscar</button>
      </form>

      {error && <div className="error">{error}</div>}

      {citas && (
        <div className="card">
          <h3>{citas.length} cita(s) de hoy</h3>
          {citas.length === 0 ? (
            <p className="nota">
              Nadie con esa búsqueda tiene cita hoy. Si viene sin cita, créasela en Agenda
              consolidada y vuelve aquí.
            </p>
          ) : (
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th><th>Paciente</th><th>Servicio</th><th>Prestador</th>
                  <th>Hora</th><th>Cobro</th><th></th>
                </tr>
              </thead>
              <tbody>
                {citas.map((c) => (
                  <Fila key={c.id} cita={c} ocupado={ocupado}
                        onRegistrar={registrar} onReimprimir={reimprimir}
                        onVerCita={() => setViendo(c)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {turno && <Ticket turno={turno} />}

      {/* El que no paga se resuelve aquí mismo: antes había que irse a Agenda
          consolidada con el paciente delante. Es el modal de siempre. */}
      {viendo && (
        <ModalCita
          cita={viendo}
          onCerrar={() => setViendo(null)}
          onCambio={() => { setViendo(null); void repetirBusqueda(); }}
        />
      )}
    </div>
  );
}

/**
 * Una fila de la búsqueda: quién es, qué se le cobra y qué se puede hacer con ella.
 *
 * El principio es que **siga siendo un clic**. El desenlace del cobro viene marcado
 * según la política del servicio, así que en el camino normal la asistente no toca
 * nada: pulsa «Registrar llegada» y ya. La fricción aparece solo en la excepción.
 */
function Fila({ cita, ocupado, onRegistrar, onReimprimir, onVerCita }: {
  cita: Cita;
  ocupado: boolean;
  onRegistrar: (c: Cita, cobro: Cobro, nota?: string) => void;
  onReimprimir: (c: Cita) => void;
  onVerCita: () => void;
}) {
  const sinCosto = cita.servicio.politicaCosto === 'sin_costo';
  const [cobro, setCobro] = useState<Cobro>(sinCosto ? 'exento' : 'cobrado');
  const [nota, setNota] = useState('');

  // RN-07.6 · solo hay que explicarse cuando el desenlace contradice la política.
  const exigeNota = sinCosto === (cobro === 'cobrado');
  const listo = !exigeNota || nota.trim().length >= 5;

  /*
   * Un turno `cancelado` es el de una llegada anterior que se anuló al mover la cita:
   * no cuenta como registrada, y el paciente puede volver a presentarse. Tratarlo
   * como registrada es lo que dejaba a esa persona sin poder registrar la llegada.
   */
  const turnoVivo = cita.turno && cita.turno.estado !== 'cancelado' ? cita.turno : null;
  const cobroAnterior = cita.turno?.estado === 'cancelado' ? cita.turno : null;
  const registrable = !turnoVivo && (cita.estado === 'pendiente_llegada' || cita.estado === 'confirmada');

  return (
    <tr>
      <td>
        {/* Abre la ficha: es la salida cuando el paciente no paga. */}
        <button className="chip chip-boton" onClick={onVerCita} title="Ver la cita">{cita.codigo}</button>
      </td>
      <td>
        {cita.paciente.apellidos}, {cita.paciente.nombres}
        <br /><span className="muted">{cita.paciente.documento}</span>
      </td>
      <td>
        {cita.servicio.nombre}
        <br />
        {/* Nunca una cifra: la plataforma no maneja importes (RN-07.6). */}
        <span className="muted">{sinCosto ? 'Sin costo (RN-01.2)' : 'Con costo · tarifa en recepción'}</span>
      </td>
      <td>{cita.prestador.nombre}</td>
      <td>{aHora(cita.horaInicio)}</td>
      <td>
        {turnoVivo
          ? <EtiquetaCobro turno={turnoVivo} />
          : registrable
            ? (
              <>
                <div className="tabs">
                  <button className={`tab ${cobro === 'cobrado' ? 'activa' : ''}`}
                          onClick={() => setCobro('cobrado')}>Cobrado</button>
                  <button className={`tab ${cobro === 'exento' ? 'activa' : ''}`}
                          onClick={() => setCobro('exento')}>No se cobró</button>
                </div>
                {exigeNota && (
                  <input className="nota-cobro" value={nota} onChange={(e) => setNota(e.target.value)}
                         placeholder={cobro === 'exento' ? 'Por qué no se cobró…' : 'Por qué se cobró…'} />
                )}
                {/* Se le movió la cita: que la asistente vea qué se resolvió la vez
                    anterior antes de decidir si vuelve a cobrar. */}
                {cobroAnterior?.cobro && (
                  <span className="muted">
                    En la llegada anterior: {cobroAnterior.cobro === 'cobrado' ? 'cobrado' : 'no se cobró'}
                  </span>
                )}
              </>
            )
            : <span className="muted">—</span>}
      </td>
      <td className="acciones">
        {cita.estado === 'cancelada' && <span className="muted">Cita cancelada</span>}
        {turnoVivo && (
          <button className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => onReimprimir(cita)}>
            Reimprimir ticket
          </button>
        )}
        {registrable && (
          <button className="btn btn-sm btn-primary" disabled={ocupado || !listo}
                  onClick={() => onRegistrar(cita, cobro, nota.trim() || undefined)}>
            Registrar llegada
          </button>
        )}
        {/* El resto de estados —atendida, en atención— no tienen acción, y decirlo
            es mejor que un botón que devuelve un 400 genérico. */}
        {!turnoVivo && !registrable && cita.estado !== 'cancelada' && (
          <span className="muted">{cita.estado.replace(/_/g, ' ')}</span>
        )}
      </td>
    </tr>
  );
}

/** Lo que se resolvió en su momento, para la fila ya registrada. */
function EtiquetaCobro({ turno }: { turno: NonNullable<Cita['turno']> }) {
  if (!turno.cobro) return <span className="muted">No consta</span>;
  const hora = turno.cobroTs
    ? new Date(turno.cobroTs).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
    : '';
  return (
    <span className={`tag ${turno.cobro === 'cobrado' ? 't-teal' : 't-amber'}`}>
      {turno.cobro === 'cobrado' ? 'Cobrado' : 'No se cobró'}{hora && ` ${hora}`}
    </span>
  );
}

/**
 * RN-09.3 · el ticket es texto formateado, no imagen: el mismo formato se envía
 * por WhatsApp como confirmación.
 *
 * Se puede recuperar después de registrada la llegada: antes vivía solo en el estado
 * de React y desaparecía al atender al siguiente paciente, así que un fallo de la
 * impresora dejaba al paciente sin nada.
 */
function Ticket({ turno }: { turno: Turno }) {
  const texto = [
    '━━━━━━━━━━━━━━━━━━',
    '  CENTRO DE PROFESIONALES & PROVIVIR',
    '  CPP Principal',
    '━━━━━━━━━━━━━━━━━━',
    `Código      ${turno.cita.codigo}`,
    `Paciente    ${turno.cita.paciente.nombres} ${turno.cita.paciente.apellidos}`,
    `Servicio    ${turno.cita.servicio.nombre}`,
    `Prestador   ${turno.cita.prestador.nombre}`,
    `Hora cita   ${aHora(turno.cita.horaInicio)}`,
    `Consultorio ${turno.consultorio ?? '—'}`,
    // La constancia que se lleva el paciente, y la que se puede reimprimir.
    `Cobro       ${turno.cobro === 'cobrado' ? 'Cobrado' : turno.cobro === 'exento' ? 'No se cobró' : 'No consta'}`,
    `Llegada     ${new Date(turno.llegadaTs).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false })}`,
    '━━━━━━━━━━━━━━━━━━',
    'Espere el llamado en la sala.',
  ].join('\n');

  return (
    <div className="card zona-ticket">
      <h3 className="sin-imprimir">Llegada registrada</h3>
      <pre className="ticket">{texto}</pre>
      <div className="acciones sin-imprimir">
        <button className="btn btn-primary" onClick={() => window.print()}>Imprimir</button>
        <button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(texto)}>Copiar texto</button>
      </div>
    </div>
  );
}
