import { useState } from 'react';
import { api, type ResultadoPrueba, type Servicio } from '../../api';
import { ofrecimiento } from './cta';

/**
 * Ensaya una pregunta contra la base y muestra qué respondería el bot.
 *
 * Va antes que el listado a propósito: lo que importa de esta pantalla no es qué
 * artículos hay, sino qué le va a llegar al paciente. La respuesta se pinta como
 * la conversación real para que se lea igual que la va a leer él.
 *
 * No registra la consulta: ensayar no debe ensuciar las métricas ni la cola de mejora.
 */

const EJEMPLOS: Array<{ etiqueta: string; pregunta: string }> = [
  { etiqueta: 'preparación de ecografía', pregunta: '¿Cómo me preparo para la ecografía?' },
  { etiqueta: 'venta de servicio', pregunta: '¿Manejan sueros de vitamina C?' },
  { etiqueta: 'sin cobertura', pregunta: '¿Tienen parqueadero para pacientes?' },
  { etiqueta: 'tema prohibido', pregunta: 'Me duele el pecho, ¿qué tengo?' },
];

export function Probador({ servicios, umbral }: { servicios: Servicio[]; umbral: number }) {
  const [pregunta, setPregunta] = useState('');
  const [resultado, setResultado] = useState<ResultadoPrueba | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  async function probar(q: string) {
    if (!q.trim()) return;
    setPregunta(q); setError(''); setCargando(true);
    try {
      setResultado(await api.probarPregunta(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card plano">
      <div className="hd">
        <h3>Probar una pregunta</h3>
        <div className="spacer" />
        <span className="tag t-gray">Umbral {umbral}</span>
      </div>

      <div className="bd">
        <div className="searchbar" style={{ marginBottom: '.7rem' }}>
          <input
            value={pregunta}
            aria-label="Pregunta para probar"
            placeholder="Ej.: ¿cómo me preparo para la ecografía?"
            onChange={(e) => setPregunta(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void probar(pregunta); }}
          />
          <button className="btn btn-primary" disabled={cargando || !pregunta.trim()}
                  onClick={() => void probar(pregunta)}>
            {cargando ? 'Buscando…' : 'Probar ➤'}
          </button>
        </div>

        <div className="chips" style={{ marginBottom: '.9rem' }}>
          {EJEMPLOS.map((e) => (
            <button key={e.etiqueta} className="btn btn-ghost btn-sm"
                    title={e.pregunta} onClick={() => void probar(e.pregunta)}>
              {e.etiqueta}
            </button>
          ))}
        </div>

        {error && <div className="error" role="alert">{error}</div>}

        {!resultado && !error && (
          <div className="empty">
            Escribe una pregunta y prueba qué respondería el bot, <b>antes</b> de que la
            haga un paciente.
          </div>
        )}

        {resultado && <Resultado r={resultado} servicios={servicios} umbral={umbral} />}
      </div>
    </div>
  );
}

function Resultado({ r, servicios, umbral }: {
  r: ResultadoPrueba; servicios: Servicio[]; umbral: number;
}) {
  const fragmentos = r.tipo === 'bloqueada' ? [] : r.fragmentos;
  const primero = fragmentos[0];

  return (
    <>
      <div className="rotulo">Fragmentos recuperados · puntaje</div>
      {fragmentos.length === 0 ? (
        <p className="small muted" style={{ padding: '.4rem 0' }}>
          {r.tipo === 'bloqueada'
            ? 'No se buscó: el tema escala antes de consultar la base.'
            : 'Ningún fragmento coincide con la pregunta.'}
        </p>
      ) : (
        fragmentos.map((f) => (
          <div key={f.fragmentoId} className="kb-row">
            <span className="small">
              📄 <b>{f.titulo}</b> <span className="muted">· v{f.version}</span>
            </span>
            <b className="small" style={{ color: f.puntaje >= umbral ? 'var(--teal-ink)' : 'var(--muted)' }}>
              {f.puntaje}
            </b>
          </div>
        ))
      )}

      <div className="rotulo">Lo que respondería el bot</div>
      <div className="conversacion-simulada">
        {r.tipo === 'bloqueada' && <RamaBloqueada tema={r.tema} />}
        {r.tipo === 'sin_cobertura' && <RamaSinCobertura mejor={r.mejorPuntaje} umbral={umbral} />}
        {r.tipo === 'respondida' && primero && (
          <RamaRespuesta
            titulo={primero.titulo}
            puntaje={r.mejorPuntaje}
            umbral={umbral}
            texto={primero.texto}
            cta={ofrecimiento(servicios.find((s) => s.id === primero.servicioId))}
          />
        )}
      </div>
    </>
  );
}

function RamaBloqueada({ tema }: { tema: string }) {
  return (
    <>
      <div className="msg sys">
        🚫 <b>Tema de escalamiento obligatorio: {tema}</b> — escala aunque el puntaje sea
        alto (RN-13.4)
      </div>
      <div className="msg ia">
        <div className="who">🤖 Asistente Provivir</div>
        Esa consulta la debe responder personal de la clínica. Te paso con una de nuestras
        asistentes ahora mismo. 🙌
      </div>
    </>
  );
}

function RamaSinCobertura({ mejor, umbral }: { mejor: number; umbral: number }) {
  return (
    <>
      <div className="msg sys">
        ⤴ <b>Sin cobertura</b> — mejor puntaje {mejor} &lt; umbral {umbral} · escala con motivo{' '}
        <code>sin_cobertura_kb</code> y la pregunta entra a la cola (RN-13.3)
      </div>
      <div className="msg ia">
        <div className="who">🤖 Asistente Provivir</div>
        Déjame confirmarlo con una de nuestras asistentes para no darte un dato equivocado.
        Te responde por este mismo chat en unos minutos. 🙌
      </div>
    </>
  );
}

function RamaRespuesta({ titulo, puntaje, umbral, texto, cta }: {
  titulo: string; puntaje: number; umbral: number; texto: string; cta: string | null;
}) {
  return (
    <>
      <div className="msg sys">
        ✅ Responde con <b>{titulo}</b> (puntaje {puntaje} ≥ {umbral})
        {cta && ' · interés detectado → ofrece cita (RN-09.8)'}
      </div>
      <div className="msg ia">
        <div className="who">🤖 Asistente Provivir</div>
        {/* El fragmento lleva el encabezado del artículo, que aquí ya está en el título. */}
        {texto.replace(/^#{1,6}\s+.*\n?/, '').trim()}
        {cta && (
          <>
            <br /><br />
            {cta}
          </>
        )}
      </div>
    </>
  );
}
