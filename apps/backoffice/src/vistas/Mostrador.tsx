import { useState } from 'react';
import { api, aHora, type Turno } from '../api';

/**
 * Especificación §2.10 · Mostrador: canal principal de llegada.
 * RN-07.1 · el paciente paga en recepción y aquí se registra la llegada.
 */
export function Mostrador() {
  const [valor, setValor] = useState('');
  const [turno, setTurno] = useState<Turno | null>(null);
  const [error, setError] = useState('');

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setTurno(null);
    const v = valor.trim();
    if (!v) return;

    // Un solo campo: si son solo dígitos es documento, si no, código de atención.
    const cuerpo = /^\d+$/.test(v) ? { documento: v } : { codigo: v.toUpperCase() };
    try {
      setTurno(await api.registrarLlegada(cuerpo));
      setValor('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

  return (
    <div className="vista">
      <header className="vista-cab"><h2>Mostrador</h2></header>
      <p className="nota">Canal principal de llegada. El paciente paga en recepción y aquí se registra su llegada.</p>

      <form className="buscador" onSubmit={registrar}>
        <input
          placeholder="Código de atención o documento…"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          autoFocus
        />
        <button className="btn btn-primary" type="submit">Registrar llegada</button>
      </form>

      {error && <div className="error">{error}</div>}

      {turno && <Ticket turno={turno} />}
    </div>
  );
}

/**
 * RN-09.3 · el ticket es texto formateado, no imagen: el mismo formato se envía
 * por WhatsApp como confirmación (Fase 4).
 */
function Ticket({ turno }: { turno: Turno }) {
  const texto = [
    '━━━━━━━━━━━━━━━━━━',
    '  GRUPO PROVIVIR',
    '  CDC Oriente',
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
    <div className="card">
      <h3>Llegada registrada</h3>
      <pre className="ticket">{texto}</pre>
      <div className="acciones">
        <button className="btn btn-primary" onClick={() => window.print()}>Imprimir</button>
        <button className="btn btn-ghost" onClick={() => void navigator.clipboard.writeText(texto)}>Copiar texto</button>
      </div>
    </div>
  );
}
