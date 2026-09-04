import { useState } from 'react';
import { api, aHora, hoyIso, type Cita, type Turno } from '../api';

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
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const hoy = hoyIso();

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setTurno(null); setCitas(null);
    if (q.trim().length < 3) { setError('Escribe al menos 3 caracteres'); return; }

    setOcupado(true);
    try {
      // Solo las de hoy: traer las de cualquier fecha obliga a buscar la buena
      // entre las del mes pasado, con el paciente esperando delante.
      setCitas(await api.buscarCitas(q.trim(), { desde: hoy, hasta: hoy }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setOcupado(false);
    }
  }

  async function registrar(cita: Cita) {
    setError(''); setOcupado(true);
    try {
      // Con el código exacto: se acabó que el motor elija por su cuenta.
      setTurno(await api.registrarLlegada({ codigo: cita.codigo }));
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
                <tr><th>Código</th><th>Paciente</th><th>Servicio</th><th>Prestador</th><th>Hora</th><th>Estado</th><th></th></tr>
              </thead>
              <tbody>
                {citas.map((c) => (
                  <tr key={c.id}>
                    <td><span className="chip">{c.codigo}</span></td>
                    <td>{c.paciente.apellidos}, {c.paciente.nombres}<br /><span className="muted">{c.paciente.documento}</span></td>
                    <td>{c.servicio.nombre}</td>
                    <td>{c.prestador.nombre}</td>
                    <td>{aHora(c.horaInicio)}</td>
                    <td>{c.estado.replace(/_/g, ' ')}</td>
                    <td className="acciones">{accion(c, registrar, reimprimir, ocupado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {turno && <Ticket turno={turno} />}
    </div>
  );
}

/**
 * Por qué se puede o no registrar esta cita, dicho en la propia fila.
 *
 * Antes todo esto era un 404 o un 400 genérico después de pulsar, y la recepcionista
 * no tenía forma de saber si el problema era la cita, el día o que ya estaba hecho.
 */
function accion(
  c: Cita,
  registrar: (c: Cita) => void,
  reimprimir: (c: Cita) => void,
  ocupado: boolean,
) {
  if (c.estado === 'cancelada') return <span className="muted">Cita cancelada</span>;
  if (c.turno) {
    return (
      <button className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => reimprimir(c)}>
        Reimprimir ticket
      </button>
    );
  }
  if (c.estado !== 'pendiente_llegada' && c.estado !== 'confirmada') {
    return <span className="muted">{c.estado.replace(/_/g, ' ')}</span>;
  }
  return (
    <button className="btn btn-sm btn-primary" disabled={ocupado} onClick={() => registrar(c)}>
      Registrar llegada
    </button>
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
