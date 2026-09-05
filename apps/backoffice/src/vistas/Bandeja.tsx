import { useCallback, useEffect, useState } from 'react';
import {
  api, type Conversacion, type ConversacionDetalle, type Interesado, type VentanaMeta,
} from '../api';

type Vista = 'pendientes' | 'cerradas' | 'todas';

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

/**
 * En qué anda una conversación, para la columna que en «Todas» tiene que servir a
 * los tres estados a la vez.
 *
 * Un hilo que el bot atendió solo no espera a nadie: `inicioDeEspera` mira
 * `reabiertaTs` y `escaladaTs`, y sin ninguno de los dos la espera sale 0. Pintar
 * «0 min» junto a quien lleva dos horas lo dejaría arriba del todo leyéndose como
 * lo más urgente de la lista, cuando es exactamente lo contrario.
 */
function enQueAnda(c: Conversacion): string {
  if (c.resueltaTs) return `Cerrada el ${fechaCorta(c.resueltaTs)}`;
  if (c.estado === 'ia_activa') return 'La atiende el bot';
  return `Esperando ${c.minutosEsperando} min`;
}

/**
 * Especificación §2.9 · Bandeja de la asistente.
 * Muestra motivo, prioridad y tiempo esperando; la asistente toma la conversación
 * y responde por WhatsApp sin salir de la plataforma (RN-08.3).
 *
 * La pestaña de cerradas existe porque una conversación resuelta desaparecía para
 * siempre: si el paciente volvía a llamar por lo mismo, no había forma de leer qué
 * se le había dicho.
 */
export function Bandeja({ usuarioId }: { usuarioId: string }) {
  const [vista, setVista] = useState<Vista>('pendientes');
  const [q, setQ] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const [soloMias, setSoloMias] = useState(false);

  const [filas, setFilas] = useState<Conversacion[]>([]);
  const [paginas, setPaginas] = useState(1);
  const [total, setTotal] = useState(0);
  const [interesados, setInteresados] = useState<Interesado[]>([]);
  const [abierta, setAbierta] = useState<ConversacionDetalle | null>(null);
  const [error, setError] = useState('');

  const recargar = useCallback(() => {
    api.bandeja({ vista, q: q.trim() || undefined, desde: desde || undefined, hasta: hasta || undefined, pagina })
      .then((p) => { setFilas(p.datos); setPaginas(p.paginas); setTotal(p.total); })
      .catch((e: Error) => setError(e.message));
    // RN-09.9.8 · los interesados van aquí y no en un tablero aparte: es donde la
    // asistente ya trabaja, y un listado en otra pantalla no lo mira nadie.
    api.interesados().then(setInteresados).catch(() => undefined);
  }, [vista, q, desde, hasta, pagina]);

  useEffect(() => {
    recargar();
    // El tiempo de espera avanza aunque no pase nada: se refresca solo. En el
    // histórico no, que ahí nada corre y recargar le movería la lista a quien lee.
    if (vista !== 'pendientes') return;
    const id = setInterval(recargar, 20_000);
    return () => clearInterval(id);
  }, [recargar, vista]);

  /** Cambiar de filtro con la página 4 puesta deja la lista vacía sin explicación. */
  const cambiar = (fn: () => void) => { fn(); setPagina(1); };

  async function abrir(id: string) {
    setError('');
    try {
      setAbierta(await api.conversacion(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  // "Solo las mías" se resuelve aquí y no en la API: la lista ya está en memoria y
  // el backend no tiene por qué saber quién pregunta para poder filtrar.
  const visibles = soloMias ? filas.filter((c) => c.tomadaPor === usuarioId) : filas;

  return (
    <div className="vista">
      <header className="vista-cab">
        <div>
          <div className="tabs">
            <button className={`tab ${vista === 'pendientes' ? 'activa' : ''}`}
                    onClick={() => cambiar(() => setVista('pendientes'))}>
              Pendientes
            </button>
            <button className={`tab ${vista === 'cerradas' ? 'activa' : ''}`}
                    onClick={() => cambiar(() => setVista('cerradas'))}>
              Cerradas
            </button>
            <button className={`tab ${vista === 'todas' ? 'activa' : ''}`}
                    onClick={() => cambiar(() => setVista('todas'))}>
              Todas
            </button>
          </div>
          <p className="nota">
            {vista === 'pendientes'
              ? 'Conversaciones que la IA no resolvió. Ordenadas por prioridad y, dentro de ella, por quién lleva más tiempo esperando.'
              : vista === 'cerradas'
                ? 'Conversaciones ya cerradas, de la más reciente a la más antigua. Se pueden reabrir para seguir atendiéndolas.'
                : 'Todas, incluidas las que el bot resolvió solo y por eso no salen en las otras dos pestañas. '
                  + 'Es donde buscar a un paciente concreto para retomar su conversación.'}
          </p>
        </div>
      </header>

      <div className="buscador">
        <input
          placeholder="Teléfono, nombre o documento…"
          value={q}
          onChange={(e) => cambiar(() => setQ(e.target.value))}
        />
        {vista !== 'pendientes' && (
          <>
            <label>Desde <input type="date" value={desde} onChange={(e) => cambiar(() => setDesde(e.target.value))} /></label>
            <label>Hasta <input type="date" value={hasta} onChange={(e) => cambiar(() => setHasta(e.target.value))} /></label>
          </>
        )}
        <label className="p-check">
          <input type="checkbox" checked={soloMias} onChange={(e) => setSoloMias(e.target.checked)} />
          Solo las mías
        </label>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <table className="tabla">
          <thead>
            <tr>
              <th>Paciente</th><th>Motivo</th><th>Prioridad</th>
              <th>{vista === 'pendientes' ? 'Tiempo esperando' : vista === 'cerradas' ? 'Cerrada' : 'Situación'}</th>
              <th>Atiende</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr key={c.id} className="fila-clickable" onClick={() => abrir(c.id)}>
                <td>
                  {c.paciente ? `${c.paciente.apellidos}, ${c.paciente.nombres}` : <span className="muted">Sin registrar</span>}
                  <br />
                  <span className="muted">{c.telefono}</span>
                </td>
                {/* `motivo` lo escribe `escalar()`: en un hilo que el bot llevó solo es nulo. */}
                <td>{c.motivo ?? <span className="muted">Sin escalar</span>}</td>
                <td>
                  <span className={`tag ${c.prioridad === 'alta' ? 't-red' : c.prioridad === 'media' ? 't-amber' : 't-gray'}`}>
                    {c.prioridad}
                  </span>
                </td>
                {vista === 'pendientes' ? (
                  /* RN-08.3 · para que la espera no "se vuelva paisaje" */
                  <td className={c.minutosEsperando > 30 ? 'espera-larga' : ''}>
                    {c.minutosEsperando} min
                    {c.reaperturas > 0 && <span className="muted"> · reabierta</span>}
                  </td>
                ) : vista === 'cerradas' ? (
                  <td>{c.resueltaTs ? fechaCorta(c.resueltaTs) : '—'}</td>
                ) : (
                  <td>{enQueAnda(c)}</td>
                )}
                <td>
                  {c.asistente
                    ? <>{c.asistente.nombre}{c.tomadaPor === usuarioId && <span className="muted"> · tú</span>}</>
                    : <span className="muted">Sin tomar</span>}
                </td>
                <td><button className="btn btn-ghost">Abrir</button></td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {soloMias && filas.length > 0
                    ? 'Ninguna a tu nombre. Quita "Solo las mías" para ver el resto.'
                    : vista === 'pendientes'
                      ? 'No hay conversaciones pendientes'
                      : vista === 'cerradas'
                        ? 'Ninguna conversación cerrada con esos filtros'
                        : 'Ninguna conversación con esos filtros'}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {paginas > 1 && (
          <div className="acciones">
            <button className="btn btn-ghost" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</button>
            <span className="muted">Página {pagina} de {paginas} · {total} conversaciones</span>
            <button className="btn btn-ghost" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</button>
          </div>
        )}
      </div>

      <Interesados filas={interesados} onAbrir={(id) => void abrir(id)} />

      {abierta && (
        <ModalConversacion
          conversacion={abierta}
          usuarioId={usuarioId}
          onCerrar={() => setAbierta(null)}
          onCambio={() => { recargar(); void abrir(abierta.id); }}
          onResuelta={() => { setAbierta(null); recargar(); }}
        />
      )}
    </div>
  );
}

/**
 * Qué se puede hacer con esta conversación, en una sola frase.
 *
 * Se calcula aquí y no en cada botón para que el aviso y lo que está habilitado no
 * puedan contradecirse: la asistente tiene que saber por qué no puede escribir antes
 * de redactar, no después de pulsar enviar.
 */
function situacion(cerrada: boolean, v: VentanaMeta) {
  if (v.dentro) {
    return cerrada
      ? { puedeEscribir: false, reabrir: true, plantilla: false,
          aviso: 'Cerrada, pero el paciente escribió hace menos de 24 h: reábrela y respóndele con normalidad.' }
      : { puedeEscribir: true, reabrir: false, plantilla: false, aviso: '' };
  }
  if (v.plantillaConfigurada) {
    return {
      puedeEscribir: false, reabrir: cerrada, plantilla: true,
      aviso: 'Pasaron más de 24 h desde el último mensaje del paciente. WhatsApp ya no admite texto libre: '
        + 'envíale la plantilla aprobada. Ojo, la plantilla no reabre la ventana — la reabre su respuesta.',
    };
  }
  return {
    puedeEscribir: false, reabrir: cerrada, plantilla: false,
    aviso: 'Pasaron más de 24 h desde el último mensaje del paciente y no hay plantilla configurada, '
      + 'así que WhatsApp no dejará salir nada. Se configura en Administración → Reglas, con el nombre aprobado en Meta.',
  };
}

/** Quién escribió un saliente. Vacío = no fue una persona. */
function firma(autor: { nombre: string } | null, tipo: string): string {
  if (autor) return autor.nombre;
  return tipo === 'plantilla' ? 'Automático' : 'Asistente virtual';
}

function ModalConversacion({ conversacion, usuarioId, onCerrar, onCambio, onResuelta }: {
  conversacion: ConversacionDetalle;
  usuarioId: string;
  onCerrar: () => void;
  onCambio: () => void;
  onResuelta: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  const cerrada = conversacion.resueltaTs !== null;
  const { puedeEscribir, reabrir, plantilla, aviso } = situacion(cerrada, conversacion.ventana);

  /** Toda acción sobre la conversación falla igual: se pinta y no se pierde el texto. */
  async function accion(fn: () => Promise<unknown>, despues: () => void = onCambio) {
    setEnviando(true); setError('');
    try {
      await fn();
      despues();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setEnviando(false);
    }
  }

  const enviar = () =>
    accion(async () => {
      await api.responderBandeja(conversacion.id, texto.trim());
      setTexto('');
    });

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>
          {conversacion.paciente
            ? `${conversacion.paciente.nombres} ${conversacion.paciente.apellidos}`
            : conversacion.telefono}
        </h3>
        <p className="nota">
          {conversacion.motivo}
          {cerrada
            ? <> · cerrada el {fechaCorta(conversacion.resueltaTs!)}</>
            : <> · esperando {conversacion.minutosEsperando} min</>}
          {conversacion.asistente && (
            <> · atiende <b>{conversacion.asistente.nombre}</b>
              {conversacion.tomadaPor === usuarioId ? ' (tú)' : ''}</>
          )}
          {conversacion.reaperturas > 0 && <> · reabierta {conversacion.reaperturas} vez(ces)</>}
        </p>

        {aviso && <div className="aviso-ventana">{aviso}</div>}
        {/*
          * Se avisa ANTES de escribir, no después: tomar la conversación la pone en
          * `en_gestion`, y en ese estado el bot deja de responder al paciente. Es lo
          * que se quiere al retomar un hilo, pero quien solo entró a leer tiene que
          * saber que pulsar «Tomar» apaga al bot en esa conversación.
          */}
        {!cerrada && conversacion.estado === 'ia_activa' && (
          <div className="aviso-ventana">
            Esta conversación la lleva el bot. Si la tomas o le escribes, deja de contestarle al
            paciente y pasa a atenderla tú.
          </div>
        )}
        {error && <div className="error">{error}</div>}

        <div className="chat">
          {conversacion.mensajes.map((m) => (
            <div key={m.id} className={`burbuja ${m.direccion === 'entrante' ? 'de-paciente' : 'de-clinica'}`}>
              {/* RN-09.2 · el adjunto del paciente se le muestra a la asistente como soporte */}
              {m.mediaPath && <Adjunto mensajeId={m.id} tipo={m.tipo} nombre={m.contenido} />}
              <span>{m.transcripcion ?? m.contenido ?? (m.mediaPath ? '' : `[${m.tipo}]`)}</span>
              <time>
                {/* Quién lo escribió: antes el bot y una persona eran indistinguibles. */}
                {m.direccion === 'saliente' && <>{firma(m.autor, m.tipo)} · </>}
                {new Date(m.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
              </time>
            </div>
          ))}
        </div>

        <div className="field">
          <textarea
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={!puedeEscribir}
            placeholder={puedeEscribir
              ? 'Escribe tu respuesta al paciente…'
              : 'No se puede escribir ahora mismo — mira el aviso de arriba.'}
          />
        </div>

        <div className="acciones">
          {puedeEscribir && (
            <button className="btn btn-primary" onClick={enviar} disabled={enviando || !texto.trim()}>
              {enviando ? 'Enviando…' : 'Responder por WhatsApp'}
            </button>
          )}
          {reabrir && (
            <button className="btn btn-primary" disabled={enviando}
                    onClick={() => accion(() => api.reabrirBandeja(conversacion.id))}>
              Reabrir y atender
            </button>
          )}
          {plantilla && (
            <button className="btn btn-primary" disabled={enviando}
                    onClick={() => accion(() => api.plantillaBandeja(conversacion.id))}>
              Enviar plantilla para que responda
            </button>
          )}
          {!cerrada && !conversacion.tomadaPor && (
            <button className="btn btn-ghost" disabled={enviando}
                    onClick={() => accion(() => api.tomarBandeja(conversacion.id))}>
              Tomar
            </button>
          )}
          {/* Sin esto, quien toma un hilo y se va lo deja bloqueado para las demás. */}
          {!cerrada && conversacion.tomadaPor === usuarioId && (
            <button className="btn btn-ghost" disabled={enviando}
                    onClick={() => accion(() => api.soltarBandeja(conversacion.id))}>
              Devolver a la bandeja
            </button>
          )}
          {!cerrada && (
            <button className="btn btn-ghost" disabled={enviando}
                    onClick={() => accion(() => api.resolverBandeja(conversacion.id), onResuelta)}>
              Marcar como resuelta
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * RN-09.9.8 · Interesados sin agendar, debajo de las conversaciones escaladas.
 *
 * No suma a la burbuja roja del menú: esa cuenta a quien espera respuesta humana
 * AHORA (RN-08.3), y mezclarlas diluye la señal que hace reaccionar a la asistente.
 */
function Interesados({ filas, onAbrir }: { filas: Interesado[]; onAbrir: (id: string) => void }) {
  const activos = filas.filter((f) => f.proximoPaso !== null);

  const cuando = (iso: string | null) => {
    if (!iso) return '—';
    const min = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
    if (min <= 0) return 'en cualquier momento';
    if (min < 60) return `en ${min} min`;
    return `en ${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
  };

  const ETIQUETA: Record<string, string> = {
    seguimiento_1: 'Seguimiento 1',
    seguimiento_2: 'Seguimiento 2',
    cierre: 'Cierre',
  };

  return (
    <div className="card">
      <div className="card-cab">
        <h3>Interesados sin agendar</h3>
        <span className="muted">
          {activos.length} en seguimiento · preguntaron por un servicio y no cerraron la cita
        </span>
      </div>

      {filas.length === 0 ? (
        <p className="nota">
          Nadie pendiente. Cuando alguien pregunte por un servicio y no agende, aparecerá aquí con
          el estado de su secuencia de seguimiento.
        </p>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th>Contacto</th><th>Servicio</th><th>Preguntó</th>
              <th>Secuencia</th><th>Próximo mensaje</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.conversacionId} className={f.proximoPaso ? '' : 'inactiva'}>
                <td>{f.paciente ?? <span className="muted">{f.telefono}</span>}</td>
                <td>{f.servicio}</td>
                <td>{new Date(f.desde).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td>
                  <span className="muted">{f.enviados} de {f.totalPasos} enviados</span>
                </td>
                <td>
                  {f.proximoPaso
                    ? <>{ETIQUETA[f.proximoPaso] ?? f.proximoPaso} <span className="muted">{cuando(f.proximoEnvio)}</span></>
                    : <span className="muted">secuencia agotada</span>}
                </td>
                <td className="acciones">
                  <button className="btn btn-sm btn-ghost" onClick={() => onAbrir(f.conversacionId)}>
                    Escribirle yo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="nota">
        La plataforma escribe a las 2 h, 5 h y 8 h, siempre dentro del horario de atención, y se
        detiene sola si el paciente responde, agenda por cualquier canal o pide no ser contactado.
        Tomar la conversación también la detiene: lo automático es el piso, no el techo.
      </p>
    </div>
  );
}

/**
 * RN-08.1 · el soporte que mandó el paciente, visible de verdad.
 *
 * Se descarga con la sesión y se muestra como object URL porque un `<img src>` no
 * puede llevar la cabecera del token. Antes solo se pintaba la etiqueta del tipo, así
 * que la asistente veía que había una orden médica y no podía leerla — que es
 * exactamente lo que RN-08 le pide hacer.
 */
function Adjunto({ mensajeId, tipo, nombre }: { mensajeId: string; tipo: string; nombre: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let vivo = true;
    let creada: string | null = null;

    api
      .mediaMensaje(mensajeId)
      .then((blob) => {
        if (!vivo) return;
        creada = URL.createObjectURL(blob);
        setUrl(creada);
      })
      .catch(() => {
        if (vivo) setFallo(true);
      });

    // El object URL retiene el archivo en memoria hasta que se revoca: sin esto, cada
    // conversación abierta deja una copia del adjunto colgada.
    return () => {
      vivo = false;
      if (creada) URL.revokeObjectURL(creada);
    };
  }, [mensajeId]);

  if (fallo) return <div className="adjunto">📎 {tipo} · no se pudo cargar</div>;
  if (!url) return <div className="adjunto">📎 {tipo} · cargando…</div>;

  if (tipo === 'imagen') {
    return (
      <a className="adjunto-imagen" href={url} target="_blank" rel="noreferrer" title="Abrir a tamaño completo">
        <img src={url} alt={nombre ?? 'Imagen enviada por el paciente'} />
      </a>
    );
  }

  if (tipo === 'audio') return <audio className="adjunto-audio" controls src={url} />;

  return (
    <a className="adjunto adjunto-enlace" href={url} target="_blank" rel="noreferrer">
      📎 Ver {tipo}
    </a>
  );
}
