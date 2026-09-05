import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Conversacion, type ConversacionDetalle, type Interesado } from '../api';
import { alPulsoDeBandeja, hayTiempoReal } from '../tiempoReal';
import { Chips } from './bandeja/Chips';
import { ListaConversaciones } from './bandeja/ListaConversaciones';
import { ListaInteresados } from './bandeja/ListaInteresados';
import { PanelHilo } from './bandeja/PanelHilo';
import type { Vista } from './bandeja/tipos';

/**
 * Especificación §2.9 · Bandeja de la asistente.
 *
 * Dos paneles, como WhatsApp Web: la lista siempre a la izquierda y el hilo a la
 * derecha. Antes era una tabla de seis columnas y un modal que la tapaba entera, así
 * que para pasar de una conversación a la siguiente había que cerrar el modal; los
 * usuarios lo reportaron como «demasiado compleja» y era exactamente eso.
 *
 * El modal desapareció: ningún estado de esta pantalla abre un overlay.
 */

/** Con el socket en pie el sondeo es una red de seguridad; sin él, es el único refresco. */
const SONDEO_CON_SOCKET_MS = 60_000;
const SONDEO_SIN_SOCKET_MS = 20_000;

/** `q` tiene `@MinLength(3)` en el DTO: por debajo, la API responde 400. */
const MINIMO_BUSQUEDA = 3;

export function Bandeja({ usuarioId }: { usuarioId: string }) {
  const [vista, setVista] = useState<Vista>('pendientes');
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [pagina, setPagina] = useState(1);
  const [soloMias, setSoloMias] = useState(false);

  const [filas, setFilas] = useState<Conversacion[]>([]);
  const [paginas, setPaginas] = useState(1);
  const [total, setTotal] = useState(0);
  const [interesados, setInteresados] = useState<Interesado[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [abierta, setAbierta] = useState<ConversacionDetalle | null>(null);
  const [error, setError] = useState('');

  /*
   * Debounce del buscador, y con mínimo de tres caracteres. No es cosmético: teclear
   * una sola letra mandaba `?q=a`, la API respondía 400 y la pantalla pintaba un error
   * rojo mientras escribías.
   */
  useEffect(() => {
    const t = setTimeout(() => {
      const limpio = q.trim();
      setBusqueda(limpio.length >= MINIMO_BUSQUEDA ? limpio : '');
      setPagina(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const enInteresados = vista === 'interesados';

  const recargar = useCallback(() => {
    if (!enInteresados) {
      api.bandeja({
        vista, q: busqueda || undefined,
        desde: desde || undefined, hasta: hasta || undefined, pagina,
      })
        .then((p) => { setFilas(p.datos); setPaginas(p.paginas); setTotal(p.total); setError(''); })
        .catch((e: Error) => setError(e.message));
    }
    // RN-09.9.8 · los interesados se traen siempre: alimentan el contador del chip.
    api.interesados().then(setInteresados).catch(() => undefined);
    api.bandejaConteo().then((c) => setPendientes(c.pendientes)).catch(() => undefined);
  }, [vista, busqueda, desde, hasta, pagina, enInteresados]);

  useEffect(recargar, [recargar]);

  /** El hilo abierto se refresca con la lista: si no, quien lo mira ve datos viejos. */
  const refrescarAbierta = useCallback(() => {
    const id = abierta?.id;
    if (!id) return;
    api.conversacion(id).then(setAbierta).catch(() => undefined);
  }, [abierta?.id]);

  /*
   * Tiempo real. El pulso llega con cada cambio, así que se agrupa: una ráfaga de tres
   * mensajes seguidos no debe disparar tres recargas.
   */
  const pulso = useRef<number | undefined>(undefined);
  useEffect(() => {
    const baja = alPulsoDeBandeja((cantidad) => {
      setPendientes(cantidad);
      clearTimeout(pulso.current);
      pulso.current = window.setTimeout(() => { recargar(); refrescarAbierta(); }, 500);
    });
    return () => { clearTimeout(pulso.current); baja(); };
  }, [recargar, refrescarAbierta]);

  /*
   * Y el sondeo se queda de red de seguridad aunque el socket funcione: los minutos de
   * espera avanzan sin que nadie emita nada, así que la columna se congelaría.
   */
  useEffect(() => {
    const id = setInterval(recargar, hayTiempoReal() ? SONDEO_CON_SOCKET_MS : SONDEO_SIN_SOCKET_MS);
    return () => clearInterval(id);
  }, [recargar]);

  async function abrir(id: string) {
    setError('');
    try {
      setAbierta(await api.conversacion(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  const cambiarVista = (v: Vista) => {
    setVista(v);
    setPagina(1);
    // El rango se limpia al salir de donde tenía sentido: si no, vuelves a «Cerradas»
    // con un filtro puesto que no recuerdas y la lista parece vacía sin motivo.
    if (v === 'pendientes' || v === 'interesados') { setDesde(''); setHasta(''); }
  };

  // «Solo las mías» filtra en memoria sobre la página actual, como hasta ahora.
  const visibles = soloMias ? filas.filter((c) => c.tomadaPor === usuarioId) : filas;

  return (
    <div className={`vista ancha`}>
      <div className={`bandeja${abierta ? ' con-abierta' : ''}`}>
        <section className="card plano bandeja-lista">
          <div className="hd">
            <h3>{TITULO[vista]}</h3>
          </div>
          <div className="bd" style={{ paddingBottom: '.6rem' }}>
            <Chips
              vista={vista} onVista={cambiarVista}
              q={q} onQ={setQ}
              soloMias={soloMias} onSoloMias={setSoloMias}
              desde={desde} hasta={hasta} onDesde={setDesde} onHasta={setHasta}
              pendientes={pendientes}
              interesados={interesados.filter((f) => f.proximoPaso !== null).length}
            />
            <p className="nota">{NOTA[vista]}</p>
            {error && <div className="error" style={{ marginTop: '.6rem' }}>{error}</div>}
          </div>

          <div className="bandeja-scroll">
            {enInteresados ? (
              <ListaInteresados
                filas={interesados}
                activaId={abierta?.id ?? null}
                onAbrir={(id) => void abrir(id)}
              />
            ) : (
              <ListaConversaciones
                filas={visibles}
                usuarioId={usuarioId}
                activaId={abierta?.id ?? null}
                onAbrir={(id) => void abrir(id)}
                vacio={vacio(vista, soloMias, filas.length, paginas)}
              />
            )}
          </div>

          {!enInteresados && (
            <div className="bandeja-pie">
              <span>{total} conversacion{total === 1 ? '' : 'es'}</span>
              {paginas > 1 && (
                <>
                  <span className="spacer" style={{ flex: 1 }} />
                  <button className="btn btn-sm btn-ghost" disabled={pagina <= 1}
                          onClick={() => setPagina(pagina - 1)}>Anterior</button>
                  <span>Página {pagina} de {paginas}</span>
                  <button className="btn btn-sm btn-ghost" disabled={pagina >= paginas}
                          onClick={() => setPagina(pagina + 1)}>Siguiente</button>
                </>
              )}
            </div>
          )}
        </section>

        {abierta ? (
          <PanelHilo
            // El `key` es el id: cambiar de conversación resetea el borrador y el
            // scroll, pero un refresco del MISMO hilo los conserva — nadie pierde lo
            // que estaba escribiendo porque entró un mensaje.
            key={abierta.id}
            conversacion={abierta}
            usuarioId={usuarioId}
            onCambio={() => { recargar(); refrescarAbierta(); }}
            onResuelta={() => { setAbierta(null); recargar(); }}
            onVolver={() => setAbierta(null)}
          />
        ) : (
          <section className="card plano bandeja-hilo">
            <div className="empty">
              <p><b>Elige una conversación</b></p>
              <p>Aquí verás el hilo completo y podrás responder sin salir de la lista.</p>
              {enInteresados && (
                <p style={{ marginTop: '1rem', maxWidth: '46ch', marginInline: 'auto' }}>
                  La plataforma escribe a las 2 h, 5 h y 8 h, siempre dentro del horario de
                  atención, y se detiene sola si el paciente responde, agenda por cualquier canal
                  o pide no ser contactado. Tomar la conversación también la detiene: lo
                  automático es el piso, no el techo.
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const TITULO: Record<Vista, string> = {
  pendientes: 'Pendientes',
  cerradas: 'Cerradas',
  todas: 'Todas',
  interesados: 'Interesados sin agendar',
};

const NOTA: Record<Vista, string> = {
  pendientes: 'Conversaciones que la IA no resolvió. Ordenadas por el mensaje más reciente; la etiqueta de prioridad va siempre a la vista.',
  cerradas: 'Conversaciones ya cerradas, de la más reciente a la más antigua. Se pueden reabrir para seguir atendiéndolas.',
  todas: 'Todas, incluidas las que el bot resolvió solo y por eso no salen en las otras dos pestañas. Es donde buscar a un paciente concreto para retomar su conversación.',
  interesados: 'Preguntaron por un servicio y no cerraron la cita. Elige a alguien para escribirle.',
};

function vacio(vista: Vista, soloMias: boolean, hay: number, paginas: number): string {
  if (soloMias && hay > 0) {
    return paginas > 1
      ? 'Ninguna a tu nombre en esta página. Quita "Solo las mías" para ver el resto.'
      : 'Ninguna a tu nombre. Quita "Solo las mías" para ver el resto.';
  }
  if (vista === 'pendientes') return 'No hay conversaciones pendientes';
  if (vista === 'cerradas') return 'Ninguna conversación cerrada con esos filtros';
  return 'Ninguna conversación con esos filtros';
}
