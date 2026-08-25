import { useEffect, useState } from 'react';
import { api, hoyIso, type CargaMedico, type Reporte, type Resumen } from '../api';

/**
 * Métricas operativas del MVP.
 *
 * El Dashboard es la vista del día; esta es la del período: ausentismo, llegadas
 * tarde y reparto por tipo de cita. La API existía desde la Fase 6 —incluido
 * `GET /metricas/resumen`, que tenía cliente y ninguna pantalla— así que aquí no
 * se calcula nada: se pinta lo que llega.
 *
 * RN-02 · el conteo comparativo entre médicos generales EXCLUYE controles y el
 * porcentaje de ocupación SÍ los cuenta. Son dos métricas distintas que coexisten;
 * `metricas.service.ts` las resuelve y esta vista no las vuelve a mezclar.
 */

/** Etiquetas de los enums de Prisma (`EstadoCita`, `OrigenCita`, `TipoCita`). */
const ESTADO: Record<string, string> = {
  pendiente_llegada: 'Pendiente de llegada',
  confirmada: 'Confirmadas',
  llego: 'Llegaron',
  en_atencion: 'En atención',
  atendida: 'Atendidas',
  cancelada: 'Canceladas',
  no_asistio: 'No presentados',
};

const ORIGEN = {
  mostrador: 'Registro en mostrador',
  whatsapp: 'WhatsApp con IA',
  autoagendamiento: 'Autoagendamiento web',
  asistente: 'Creadas por la asistente',
} as const;

const TIPO: Record<string, string> = {
  general: 'Consultas generales',
  control: 'Citas de control',
  procedimiento: 'Procedimientos',
  examen: 'Exámenes',
};

/** Los estados que interesan como señal de operación, en el orden en que se leen. */
const OPERACION: Array<{ clave: string; alerta?: boolean }> = [
  { clave: 'atendida' },
  { clave: 'no_asistio', alerta: true },
  { clave: 'cancelada', alerta: true },
];

export function Metricas() {
  const [desde, setDesde] = useState(hoyIso());
  const [hasta, setHasta] = useState(hoyIso());
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [balanceo, setBalanceo] = useState<CargaMedico[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    Promise.all([api.reporte(desde, hasta), api.resumen(desde, hasta), api.balanceo(desde)])
      .then(([rep, res, bal]) => { setReporte(rep); setResumen(res); setBalanceo(bal); })
      .catch((e: Error) => setError(e.message));
  }, [desde, hasta]);

  if (error) return <div className="vista"><div className="error">{error}</div></div>;
  if (!reporte || !resumen) return <div className="vista"><p className="nota">Cargando métricas…</p></div>;

  const wa = reporte.whatsapp;
  const mostrador = resumen.citas.porOrigen.mostrador ?? 0;

  return (
    <div className="vista ancha">
      <header className="vista-cab" style={{ justifyContent: 'flex-end' }}>
        <div className="rango">
          <label>Desde <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></label>
          <label>Hasta <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></label>
        </div>
      </header>

      <div className="card plano" style={{ marginBottom: '1rem' }}>
        <div className="bd small muted">
          📌 El tablero definitivo («todo en un pantallazo») se construirá con las métricas que
          defina Grupo Provivir (pendiente <b>P5</b>). Esta es la propuesta base compartida en la
          reunión, sobre datos reales del rango seleccionado.
        </div>
      </div>

      <div className="grid g4">
        <div className="card kpi accent">
          <div className="lb">Resolución automática IA</div>
          <div className="vl">{wa.porcentajeResolucionIa}%</div>
          <div className="dt">{wa.resueltasPorIa} de {wa.conversaciones} conversaciones · meta 70–90%</div>
        </div>
        <div className="card kpi">
          <div className="lb">Tiempo prom. de espera</div>
          <div className="vl">{resumen.sala.esperaPromedioMin} min</div>
          <div className="dt">Meta: ≤ 15 min</div>
        </div>
        <div className="card kpi">
          <div className="lb">Registros en mostrador</div>
          <div className="vl">{mostrador}</div>
          <div className="dt">Canal principal de llegada</div>
        </div>
        <div className="card kpi">
          <div className="lb">Check-in por kiosko</div>
          <div className="vl">{resumen.kiosko.activo ? resumen.kiosko.llegadas : '—'}</div>
          <div className="dt">
            {resumen.kiosko.activo
              ? resumen.kiosko.nota
              : <><span className="tag t-gray">Módulo apagado</span> se conserva para el futuro</>}
          </div>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <Barras
          titulo="Balanceo · Medicina general"
          etiqueta={<span className="tag t-teal">solo consultas</span>}
          /* RN-02 · `consultasGenerales`, no el total: el conteo comparativo excluye controles. */
          filas={balanceo.map((m) => ({ nombre: m.nombre, valor: m.consultasGenerales, tono: 'alt' as const }))}
          leyenda="Distribución objetivo: ±10% entre los médicos generales · los controles no cuentan (RN-02)"
          vacio="Sin citas de medicina general en la fecha."
        />

        <Barras
          titulo="Canal de WhatsApp"
          filas={[
            { nombre: 'Resueltas por la IA', valor: wa.resueltasPorIa },
            { nombre: 'Escaladas a asistente', valor: wa.escaladas, tono: 'warn' },
            { nombre: ORIGEN.autoagendamiento, valor: resumen.citas.porOrigen.autoagendamiento ?? 0, tono: 'alt' },
            { nombre: ORIGEN.whatsapp, valor: resumen.citas.porOrigen.whatsapp ?? 0 },
          ]}
          leyenda="Lo que la IA no resuelve escala con motivo; nunca se aproxima una respuesta (RN-13)."
        />

        <Barras
          titulo="Operación en sede"
          filas={[
            { nombre: 'Llegadas registradas', valor: resumen.sala.llegadas, tono: 'alt' },
            ...OPERACION.map((o) => ({
              nombre: ESTADO[o.clave] ?? o.clave,
              valor: resumen.citas.porEstado[o.clave] ?? 0,
              tono: o.alerta ? ('warn' as const) : undefined,
            })),
          ]}
          leyenda={`En espera ahora mismo: ${resumen.sala.enEspera}.`}
        />

        <Barras
          titulo="Citas por tipo"
          filas={Object.entries(resumen.citas.porTipo)
            .map(([tipo, n]) => ({ nombre: TIPO[tipo] ?? tipo, valor: n }))}
          leyenda={`${resumen.citas.total} cita(s) en el rango.`}
          vacio="Sin citas en el rango seleccionado."
        />
      </div>

      <div className="card plano" style={{ marginTop: '1rem' }}>
        <div className="hd"><h3>Citas por servicio</h3></div>
        <div className="bd tabla-ancha">
          <table className="tabla">
            <thead><tr><th>Servicio</th><th className="right">Citas</th></tr></thead>
            <tbody>
              {reporte.porServicio.length === 0 && (
                <tr><td colSpan={2} className="empty">Sin citas en el rango seleccionado.</td></tr>
              )}
              {reporte.porServicio.map((s) => (
                <tr key={s.servicio}><td>{s.servicio}</td><td className="right">{s.citas}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface Fila { nombre: string; valor: number; tono?: 'alt' | 'warn' }

/** Barras normalizadas al máximo de su propia tarjeta: comparan dentro, no entre tarjetas. */
function Barras({ titulo, etiqueta, filas, leyenda, vacio }: {
  titulo: string;
  etiqueta?: React.ReactNode;
  filas: Fila[];
  leyenda: string;
  vacio?: string;
}) {
  const max = Math.max(1, ...filas.map((f) => f.valor));

  return (
    <div className="card plano">
      <div className="hd"><h3>{titulo}</h3><div className="spacer" />{etiqueta}</div>
      <div className="bd">
        {filas.length === 0 && <div className="empty">{vacio ?? 'Sin datos.'}</div>}
        {filas.map((f) => (
          <div className="bar-row" key={f.nombre}>
            <span className="small">{f.nombre}</span>
            <div className="bar-track">
              <i className={f.tono ?? ''} style={{ width: `${(f.valor / max) * 100}%` }} />
            </div>
            <span className="right">{f.valor}</span>
          </div>
        ))}
        <div className="legend"><span>{leyenda}</span></div>
      </div>
    </div>
  );
}
