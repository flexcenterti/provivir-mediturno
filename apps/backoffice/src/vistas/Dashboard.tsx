import { useEffect, useState } from 'react';
import { api, hoyIso, type CargaMedico, type Cita, type Reporte } from '../api';

/**
 * Especificación §2.7 · Dashboard.
 * Fecha visible + selector de rango, buscador de citas y panel de balanceo de MG.
 */
export function Dashboard() {
  const [desde, setDesde] = useState(hoyIso());
  const [hasta, setHasta] = useState(hoyIso());
  const [resumen, setResumen] = useState<Reporte | null>(null);
  const [balanceo, setBalanceo] = useState<CargaMedico[]>([]);
  const [q, setQ] = useState('');
  const [encontradas, setEncontradas] = useState<Cita[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.reporte(desde, hasta), api.balanceo(desde)])
      .then(([r, b]) => { setResumen(r); setBalanceo(b); })
      .catch((e) => setError(e.message));
  }, [desde, hasta]);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    try {
      setEncontradas(await api.buscarCitas(q));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  }

  const fechaLarga = new Date(`${desde}T12:00:00`).toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="vista">
      <header className="vista-cab">
        <div>
          <h2>Dashboard</h2>
          {/* El cliente lo pidió expresamente: "hoy, fecha tal" */}
          <p className="fecha-larga">{fechaLarga}</p>
        </div>
        <div className="rango">
          <label>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      {/* Especificación §2.7 · más de 400 citas/día: la búsqueda visual es inviable */}
      <form className="buscador" onSubmit={buscar}>
        <input
          placeholder="Buscar por código, nombre o documento…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">Buscar</button>
        {encontradas && <button type="button" className="btn btn-ghost" onClick={() => { setEncontradas(null); setQ(''); }}>Limpiar</button>}
      </form>

      {encontradas && (
        <div className="card">
          <h3>{encontradas.length} resultado(s)</h3>
          <TablaCitas citas={encontradas} />
        </div>
      )}

      {resumen && (
        <div className="kpis">
          <Kpi titulo="Citas del rango" valor={resumen.citas.total} />
          <Kpi titulo="Llegadas" valor={resumen.sala.llegadas} />
          <Kpi titulo="En espera" valor={resumen.sala.enEspera} />
          <Kpi titulo="Espera promedio" valor={`${resumen.sala.esperaPromedioMin} min`} />
        </div>
      )}

      <div className="card">
        <h3>Balanceo de medicina general</h3>
        <p className="nota">
          El conteo comparativo excluye los controles (no facturan); la ocupación sí los
          incluye porque ocupan tiempo. Son dos indicadores distintos.
        </p>
        <table className="tabla">
          <thead>
            <tr>
              <th>Médico</th>
              <th>Consultas generales</th>
              <th>Controles</th>
              <th>Ocupación</th>
            </tr>
          </thead>
          <tbody>
            {balanceo.map((m) => (
              <tr key={m.prestadorId}>
                <td>{m.nombre}</td>
                <td><strong>{m.consultasGenerales}</strong></td>
                <td className="muted">{m.controles}</td>
                <td>
                  <div className="barra"><span style={{ width: `${m.ocupacionPorcentaje}%` }} /></div>
                  {m.ocupacionPorcentaje}% · {m.minutosOcupados}/{m.minutosJornada} min
                </td>
              </tr>
            ))}
            {balanceo.length === 0 && <tr><td colSpan={4} className="muted">Sin datos para la fecha</td></tr>}
          </tbody>
        </table>
      </div>

      {resumen && (
        <div className="card">
          <h3>Canal WhatsApp</h3>
          <div className="kpis">
            <Kpi titulo="Conversaciones" valor={resumen.whatsapp.conversaciones} />
            <Kpi titulo="Resueltas por la IA" valor={`${resumen.whatsapp.porcentajeResolucionIa}%`} />
            <Kpi titulo="Escaladas" valor={resumen.whatsapp.escaladas} />
          </div>
          <p className="nota">
            La expectativa comunicada al cliente es 30–40 % de resolución automática al arranque,
            con mejora progresiva hacia 70–90 % al incorporar las dinámicas de la clínica.
          </p>
        </div>
      )}

      {resumen && resumen.porServicio.length > 0 && (
        <div className="card">
          <h3>Citas por servicio</h3>
          <table className="tabla">
            <thead><tr><th>Servicio</th><th>Citas</th></tr></thead>
            <tbody>
              {resumen.porServicio.map((s) => (
                <tr key={s.servicio}><td>{s.servicio}</td><td><strong>{s.citas}</strong></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resumen && (
        <div className="card">
          <h3>Kiosko vs mostrador</h3>
          <p className="nota">{resumen.kiosko.nota}</p>
        </div>
      )}
    </div>
  );
}

function Kpi({ titulo, valor }: { titulo: string; valor: string | number }) {
  return (
    <div className="kpi">
      <span className="kpi-t">{titulo}</span>
      <strong className="kpi-v">{valor}</strong>
    </div>
  );
}

export function TablaCitas({ citas }: { citas: Cita[] }) {
  return (
    <table className="tabla">
      <thead>
        <tr><th>Código</th><th>Paciente</th><th>Servicio</th><th>Tipo</th><th>Prestador</th><th>Fecha</th><th>Hora</th><th>Estado</th></tr>
      </thead>
      <tbody>
        {citas.map((c) => (
          <tr key={c.id}>
            <td><span className="chip">{c.codigo}</span></td>
            <td>{c.paciente.apellidos}, {c.paciente.nombres}</td>
            <td>{c.servicio.nombre}</td>
            <td><EtiquetaTipo tipo={c.tipo} /></td>
            <td>{c.prestador.nombre}</td>
            <td>{c.fecha.slice(0, 10)}</td>
            <td>{aHoraLocal(c.horaInicio)}</td>
            <td>{c.estado.replace(/_/g, ' ')}</td>
          </tr>
        ))}
        {citas.length === 0 && <tr><td colSpan={8} className="muted">Sin citas</td></tr>}
      </tbody>
    </table>
  );
}

export function EtiquetaTipo({ tipo }: { tipo: string }) {
  const clase = { control: 't-amber', procedimiento: 't-blue', examen: 't-blue' }[tipo] ?? 't-teal';
  const texto = { general: 'Consulta', control: 'Control', procedimiento: 'Procedimiento', examen: 'Examen' }[tipo] ?? tipo;
  return <span className={`tag ${clase}`}>{texto}</span>;
}

const aHoraLocal = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
