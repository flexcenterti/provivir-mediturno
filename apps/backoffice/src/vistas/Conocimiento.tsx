import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Articulo,
  type PreguntaPendiente,
  type ResultadoPrueba,
  type Servicio,
} from '../api';

/**
 * RN-13 · Base de conocimiento del bot.
 *
 * Es la pantalla donde se decide qué le responde la plataforma a los pacientes, así
 * que lo primero que ofrece no es el listado sino el **probador**: permite ver qué
 * recuperaría el bot antes de que la pregunta la haga alguien de verdad.
 */
export function Conocimiento() {
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [pendientes, setPendientes] = useState<PreguntaPendiente[]>([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const recargar = useCallback(() => {
    Promise.all([api.articulos(), api.servicios(true), api.preguntasPendientes()])
      .then(([a, s, p]) => { setArticulos(a); setServicios(s); setPendientes(p); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(recargar, [recargar]);

  const nombreServicio = (id: string | null) => servicios.find((s) => s.id === id)?.nombre ?? null;

  /**
   * `fn` puede devolver su propio mensaje. Sin eso, el genérico pisaba el informe
   * de la importación, que es justo la parte útil: cuántos entraron y cuáles
   * quedaron sin servicio vinculado.
   */
  async function accion(fn: () => Promise<string | void>, exito?: string) {
    setError(''); setAviso('');
    try {
      const propio = await fn();
      setAviso(propio ?? exito ?? '');
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const publicados = articulos.filter((a) => a.estado === 'publicado');
  const paraRevisar = articulos.filter((a) => a.requiereRevision);

  return (
    <div className="vista">
      <header className="vista-cab">
        <div>
          <h2>Base de conocimiento</h2>
          <p className="nota">
            Lo que el bot responde antes de escalar. Si ninguna ficha cubre la pregunta,
            escala en vez de aproximar: nunca inventa horarios, precios ni indicaciones.
          </p>
        </div>
        {publicados.length === 0 && (
          <button
            className="btn"
            onClick={() => accion(async () => {
              const r = await api.importarConocimiento();
              return (
                `${r.creados.length} artículo(s) importados.` +
                (r.sinServicio.length
                  ? ` ${r.sinServicio.length} quedaron sin servicio vinculado y conviene atarlos a mano: ${r.sinServicio.join(', ')}.`
                  : '')
              );
            })}
          >
            Importar documentación comercial
          </button>
        )}
      </header>

      {error && <div className="error">{error}</div>}
      {aviso && <div className="aviso">{aviso}</div>}

      {paraRevisar.length > 0 && (
        <div className="aviso">
          {paraRevisar.length} artículo(s) marcados para revisión porque su servicio se desactivó.
          Revísalos y archívalos si ya no aplican: dejar viva la ficha de un servicio que no se
          presta es como el bot termina ofreciendo algo inexistente.
        </div>
      )}

      <Probador servicios={servicios} />

      <PreguntasSinRespuesta
        pendientes={pendientes}
        onCrear={(id) => accion(async () => { await api.articuloDesdePendiente(id); }, 'Borrador creado desde la pregunta')}
        onDescartar={(id) => accion(async () => { await api.descartarPendiente(id); }, 'Pregunta descartada')}
      />

      <div className="card">
        <div className="card-cab">
          <h3>Artículos</h3>
          <span className="muted">
            {publicados.length} publicados · {articulos.filter((a) => a.estado === 'borrador').length} en
            borrador · {articulos.filter((a) => a.estado === 'archivado').length} archivados
          </span>
        </div>

        {articulos.length === 0 ? (
          <p className="nota">
            Todavía no hay artículos. Mientras la base esté vacía, el bot usa el bloque de
            documentación comercial que está en Administración → Reglas.
          </p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Título</th><th>Categoría</th><th>Servicio</th>
                <th>Estado</th><th>Versión</th><th></th>
              </tr>
            </thead>
            <tbody>
              {articulos.map((a) => (
                <tr key={a.id} className={a.estado === 'archivado' ? 'inactiva' : ''}>
                  <td>
                    <strong>{a.titulo}</strong>
                    {a.requiereRevision && <span className="etiqueta"> revisar</span>}
                  </td>
                  <td>{a.categoria}</td>
                  <td>{nombreServicio(a.servicioId) ?? <span className="muted">— general</span>}</td>
                  <td><EstadoArticulo estado={a.estado} /></td>
                  <td>v{a.version}</td>
                  <td className="acciones">
                    {a.estado === 'borrador' && (
                      <>
                        <button className="btn btn-sm" onClick={() => accion(async () => { await api.publicarArticulo(a.id); }, `«${a.titulo}» publicado`)}>
                          Publicar
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => accion(async () => { await api.eliminarArticulo(a.id); }, 'Borrador eliminado')}>
                          Eliminar
                        </button>
                      </>
                    )}
                    {a.estado === 'publicado' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => accion(async () => { await api.archivarArticulo(a.id); }, `«${a.titulo}» archivado: sale del índice ahora`)}>
                        Archivar
                      </button>
                    )}
                    {a.estado === 'archivado' && (
                      <button className="btn btn-sm btn-ghost" onClick={() => accion(async () => { await api.reactivarArticulo(a.id); }, 'Vuelve a borrador para revisarlo')}>
                        Reactivar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="nota">
          Los artículos se archivan, no se borran: la auditoría debe poder explicar respuestas que
          el bot ya dio con ellos. Solo los borradores, que nunca sustentaron una respuesta, se
          eliminan de verdad.
        </p>
      </div>
    </div>
  );
}

function EstadoArticulo({ estado }: { estado: Articulo['estado'] }) {
  if (estado === 'publicado') return <span className="pill pill-ok">Publicado</span>;
  if (estado === 'borrador') return <span className="pill pill-aviso">Borrador</span>;
  return <span className="pill">Archivado</span>;
}

/** Ensaya una pregunta contra la base sin registrarla en las métricas ni en la cola. */
function Probador({ servicios }: { servicios: Servicio[] }) {
  const [pregunta, setPregunta] = useState('');
  const [resultado, setResultado] = useState<ResultadoPrueba | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const EJEMPLOS = [
    '¿Cómo me preparo para la ecografía?',
    '¿A qué hora abren los sábados?',
    '¿Tienen parqueadero?',
    'Me duele el pecho, ¿qué tengo?',
  ];

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
    <div className="card">
      <div className="card-cab">
        <h3>Probar una pregunta</h3>
        <span className="muted">No cuenta para las métricas ni para la cola de mejora</span>
      </div>

      <div className="fila-form">
        <input
          value={pregunta}
          placeholder="Escribe una pregunta como la haría un paciente"
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void probar(pregunta); }}
        />
        <button className="btn" disabled={cargando || !pregunta.trim()} onClick={() => void probar(pregunta)}>
          {cargando ? 'Buscando…' : 'Probar'}
        </button>
      </div>

      <div className="chips">
        {EJEMPLOS.map((e) => (
          <button key={e} className="chip" onClick={() => void probar(e)}>{e}</button>
        ))}
      </div>

      {error && <div className="error">{error}</div>}
      {resultado && <ResultadoDePrueba r={resultado} servicios={servicios} />}
    </div>
  );
}

function ResultadoDePrueba({ r, servicios }: { r: ResultadoPrueba; servicios: Servicio[] }) {
  if (r.tipo === 'bloqueada') {
    return (
      <div className="resultado-prueba">
        <p className="pill pill-error">Escala siempre · {r.tema}</p>
        <p className="nota">
          Este tema pasa a una persona aunque exista un artículo que lo cubra. La lista se
          configura en Administración → Reglas.
        </p>
      </div>
    );
  }

  if (r.tipo === 'sin_cobertura') {
    return (
      <div className="resultado-prueba">
        <p className="pill pill-aviso">Sin cobertura · mejor coincidencia {r.mejorPuntaje}</p>
        <p className="nota">
          El bot escala en vez de responder, y la pregunta entra a «Preguntas sin respuesta».
          Si debería saber contestarla, ahí mismo se convierte en artículo.
        </p>
      </div>
    );
  }

  const primero = r.fragmentos[0];
  const servicio = servicios.find((s) => s.id && primero && s.nombre && primero.titulo.includes(s.nombre));

  return (
    <div className="resultado-prueba">
      <p className="pill pill-ok">Responde · coincidencia {r.mejorPuntaje}</p>
      {r.fragmentos.map((f, i) => (
        <div key={i} className="fragmento">
          <strong>{f.titulo}</strong> <span className="muted">· {f.puntaje}</span>
          {/* El fragmento lleva el encabezado del artículo, que aquí ya está en el título. */}
          <p>{f.texto.replace(/^#{1,6}\s+.*\n?/, '').trim()}</p>
        </div>
      ))}
      {servicio && (
        <p className="nota">
          Las cifras de la respuesta —duración, costo, cuántos espacios ocupa— no salen de este
          texto sino de la ficha de «{servicio.nombre}» en el catálogo.
        </p>
      )}
    </div>
  );
}

function PreguntasSinRespuesta({
  pendientes,
  onCrear,
  onDescartar,
}: {
  pendientes: PreguntaPendiente[];
  onCrear: (id: string) => void;
  onDescartar: (id: string) => void;
}) {
  return (
    <div className="card">
      <div className="card-cab">
        <h3>Preguntas sin respuesta</h3>
        <span className="muted">Lo que los pacientes preguntaron y el bot no supo contestar</span>
      </div>

      {pendientes.length === 0 ? (
        <p className="nota">
          Nada pendiente. Cuando alguien pregunte algo que la base no cubre, aparecerá aquí
          agrupado por frecuencia.
        </p>
      ) : (
        <table className="tabla">
          <thead>
            <tr><th>Pregunta</th><th>Veces</th><th></th></tr>
          </thead>
          <tbody>
            {pendientes.map((p) => (
              <tr key={p.id}>
                <td>{p.preguntaEjemplo}</td>
                <td>{p.ocurrencias}</td>
                <td className="acciones">
                  <button className="btn btn-sm" onClick={() => onCrear(p.id)}>Crear artículo</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => onDescartar(p.id)}>Descartar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="nota">
        Convertir las más repetidas en artículos es lo que hace que el bot resuelva cada vez más
        sin pasar por una persona.
      </p>
    </div>
  );
}
