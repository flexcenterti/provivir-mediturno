import { useCallback, useEffect, useRef, useState } from 'react';
import { interpretarYoutube, urlEmbedDirecto } from '@provivir/shared';
import { io, type Socket } from 'socket.io-client';
import { alCambiarVoces, anunciar, apagar, armar, hayVozEspanola, type EstadoSonido } from './sonido';

interface Llamado {
  turnoId: string;
  codigo: string;
  paciente: string;
  prestador: string;
  consultorio: string | null;
  ts: string;
  repetido?: boolean;
}

interface Anuncio {
  id: string;
  url: string;
}

interface ConfigPantalla {
  id: string;
  nombre: string;
  servicios: string[];
  turnosVisibles: number;
  sonido: boolean;
  mensaje: string | null;
  media: boolean;
  canalYoutube: string | null;
  videosPromo: string[];
  intervaloInstitucionalMin: number;
}

/**
 * RN-11.5 · el estado del sonido de esta pantalla.
 *
 * Tres estados y no dos, porque «no suena» tiene causas con arreglos distintos: la
 * pantalla está configurada sin sonido (se arregla en el backoffice), nadie ha tocado
 * el televisor (se arregla con el mando), o el aparato no trae voz en español (se
 * arregla instalando el idioma). Sin distinguirlos, quien instala el stick no sabe
 * dónde mirar.
 */
function useSonido(activado: boolean) {
  const [estado, setEstado] = useState<EstadoSonido>('apagado');

  const activar = useCallback(() => {
    void armar().then((listo) => {
      if (listo) setEstado(hayVozEspanola() ? 'activo' : 'sin-voz');
    });
  }, []);

  useEffect(() => {
    if (!activado) { apagar(); setEstado('apagado'); return; }

    setEstado('pendiente');
    // Con el navegador del kiosko lanzado con --autoplay-policy=no-user-gesture-required
    // esto ya prospera y la franja no llega a verse.
    void armar().then((listo) => {
      setEstado(listo ? (hayVozEspanola() ? 'activo' : 'sin-voz') : 'pendiente');
    });

    // El paquete de voces puede llegar después del primer render: `getVoices()` da []
    // hasta que dispara `voiceschanged`, y decidir con la primera respuesta condenaría
    // al televisor al silencio para siempre.
    const soltar = alCambiarVoces(() => {
      setEstado((e) => (e === 'pendiente' || e === 'apagado' ? e : (hayVozEspanola() ? 'activo' : 'sin-voz')));
    });
    return () => { soltar(); apagar(); };
  }, [activado]);

  return { estado, activar };
}

/**
 * La franja de activación. **Nunca tapa el turno que se está llamando**: una sala de
 * espera con el tablero escondido detrás de una petición de permisos está peor que
 * muda.
 *
 * Es un `<button>` de verdad y enfocado, y eso es lo que la hace usable con el mando de
 * un stick: el botón OK dispara un `click` sobre el elemento con foco. Un `<div
 * onClick>` no lo recibiría nunca, y en un televisor sin táctil no habría forma de
 * activar el sonido.
 */
function FranjaSonido({ onActivar }: { onActivar: () => void }) {
  return (
    <button className="tv-armar" autoFocus onClick={onActivar}>
      Toca la pantalla o pulsa OK en el control para activar el sonido
      <small>Los llamados se ven igual sin sonido.</small>
    </button>
  );
}

/**
 * El reloj de la cabecera, con la hora del SERVIDOR.
 *
 * Los sticks HDMI baratos no traen reloj de batería y arrancan con la zona horaria mal,
 * y un reloj equivocado colgado en la pared de una sala de espera es peor que no tener
 * ninguno. El servidor manda su hora en cada sondeo, se guarda el desfase una vez y a
 * partir de ahí la pantalla avanza sola.
 *
 * Vale además como indicador de vida: un televisor congelado es hoy indistinguible de
 * una mañana tranquila, y un reloj que avanza lo distingue de un vistazo.
 *
 * Componente propio para que su tic no vuelva a renderizar el árbol que contiene el
 * reproductor de YouTube.
 */
function Reloj({ desfaseMs }: { desfaseMs: number }) {
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    /*
     * Se re-arma al minuto exacto siguiente en vez de un `setInterval(1000)`: se pintan
     * horas y minutos, así que un tic por segundo son 86.400 renders al día en un
     * aparato que ya está peleando con un iframe de YouTube.
     */
    const t = setTimeout(() => setAhora(new Date()), 60_000 - (Date.now() % 60_000));
    return () => clearTimeout(t);
  }, [ahora]);

  const t = new Date(ahora.getTime() + desfaseMs);
  const opciones = { timeZone: 'America/Bogota' } as const;
  const dia = t.toLocaleDateString('es-CO', { ...opciones, weekday: 'short', day: 'numeric', month: 'short' });
  const hora = t.toLocaleTimeString('es-CO', { ...opciones, hour: '2-digit', minute: '2-digit' });

  return <span className="tv-reloj"><strong>{hora}</strong> {dia}</span>;
}

/**
 * RN-11 · Pantalla de sala en modo kiosk. Ruta final: /tv/:pantallaId.
 * El id de pantalla viene por query (?pantalla=…) para no depender de un router.
 */
export function App() {
  const pantallaId = new URLSearchParams(location.search).get('pantalla') ?? '';
  const [config, setConfig] = useState<ConfigPantalla | null>(null);
  const [llamados, setLlamados] = useState<Llamado[]>([]);
  /*
   * `anuncios` y `ahora` viven en su propio estado y NO dentro de `config`: si entraran
   * ahí, la comparación de abajo no coincidiría nunca y el reproductor de YouTube se
   * recrearía cada 60 s.
   */
  const [anuncios, setAnuncios] = useState<Anuncio[]>([]);
  const [desfaseMs, setDesfaseMs] = useState(0);
  const [caidos, setCaidos] = useState<string[]>([]);
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);
  /* El anuncio cuelga del socket, no del estado: ver el comentario del handler. */
  const sonandoRef = useRef(false);

  useEffect(() => {
    if (!pantallaId) { setError('Falta el parámetro ?pantalla=<id>'); return; }

    const cargar = () =>
      fetch(`/api/pantallas/${pantallaId}/estado`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Pantalla no encontrada'))))
        .then((d) => {
          /*
           * Solo se reemplaza si cambió de verdad. Reasignar un objeto idéntico cada
           * minuto hacía trepidar todo efecto llaveado en `config` — y en particular
           * destruía y recreaba el reproductor de YouTube, así que un video
           * institucional de más de 60 s no llegaba jamás a su evento de fin.
           */
          setConfig((prev) => (
            JSON.stringify(prev) === JSON.stringify(d.pantalla) ? prev : d.pantalla
          ));
          setLlamados(d.llamados);
          setAnuncios(d.anuncios ?? []);
          // El reloj se alinea con el servidor, no con el aparato: los sticks HDMI
          // baratos no traen reloj y arrancan con la zona horaria mal.
          if (d.ahora) setDesfaseMs(new Date(d.ahora).getTime() - Date.now());
        })
        .catch((e: Error) => setError(e.message));

    void cargar();

    // Llamados en vivo por WebSocket; el fetch periódico es la red de seguridad
    // si la TV pierde la conexión un rato.
    const socket = io('/tiempo-real', { path: '/tiempo-real', transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('suscribir-pantalla', pantallaId));
    socket.on('llamado', (l: Llamado) => {
      // Llaveado por turno: el mismo llega por el sondeo y por el socket, y con el
      // rellamado, varias veces por el socket.
      setLlamados((prev) => [l, ...prev.filter((x) => x.turnoId !== l.turnoId)].slice(0, 12));
      /*
       * Se anuncia AQUÍ y en ningún otro sitio. Colgarlo del estado haría que cada
       * refetch de 60 s —o una reconexión— le recitara a la sala los últimos cuatro
       * turnos.
       */
      if (sonandoRef.current) anunciar(l);
    });
    socket.on('retirar-llamado', ({ turnoId }: { turnoId: string }) => {
      setLlamados((prev) => prev.filter((x) => x.turnoId !== turnoId));
    });

    const id = setInterval(cargar, 60_000);
    return () => { socket.disconnect(); clearInterval(id); };
  }, [pantallaId]);

  const sonido = useSonido(config?.sonido ?? false);
  sonandoRef.current = sonido.estado === 'activo' || sonido.estado === 'sin-voz';

  if (error) return <div className="tv-error">{error}</div>;
  if (!config) return <div className="tv-error">Conectando…</div>;

  const visibles = llamados.slice(0, config.turnosVisibles);
  const actual = visibles[0];
  /*
   * Un anuncio que no carga sale de la franja entera. Dos carteles se ven bien; dos
   * carteles y un icono de imagen rota en la pared, no. Y si caen todos, `data-anuncios`
   * pasa a `no` y la franja desaparece en vez de dejar una banda negra bajo el video
   * que parece una avería del televisor.
   */
  const vivos = anuncios.filter((a) => !caidos.includes(a.id));

  return (
    <div className="tv">
      <header className="tv-cab">
        <div className="brand-mark">CPP</div>
        <h1>Centro de Profesionales & Provivir · CPP Principal</h1>
        <span className="tv-cab-derecha">
          <Reloj desfaseMs={desfaseMs} />
          <span className="tv-sala">{config.nombre}</span>
        </span>
        {sonido.estado === 'sin-voz' && (
          <span className="tv-aviso" title="Falta el paquete de voz en español en el televisor">
            Sin voz en español
          </span>
        )}
      </header>

      {sonido.estado === 'pendiente' && <FranjaSonido onActivar={sonido.activar} />}

      <div
        className="tv-cuerpo"
        /*
         * Atributos de datos y no clases compuestas: componer clases deja combinaciones
         * sin CSS que solo se descubren en la sala, y esto es greppable y afirmable
         * desde una prueba de navegador.
         */
        data-media={config.media ? 'si' : 'no'}
        data-anuncios={vivos.length ? 'si' : 'no'}
      >
        <section className="tv-turnos">
          {actual ? (
            <div className="tv-actual">
              <span className="tv-etiqueta">Turno en atención</span>
              <strong className="tv-codigo">{actual.codigo}</strong>
              <span className="tv-paciente">{actual.paciente}</span>
              <span className="tv-consultorio">{actual.consultorio ?? actual.prestador}</span>
            </div>
          ) : (
            <div className="tv-actual">
              {/* Una pantalla sin servicios no recibe un solo llamado en toda su vida,
                  y «Esperando llamados» es indistinguible de una sala tranquila. */}
              <span className="tv-etiqueta">
                {config.servicios.length === 0
                  ? 'Esta pantalla no tiene servicios asignados'
                  : 'Esperando llamados'}
              </span>
            </div>
          )}

          <ul className="tv-lista">
            {visibles.slice(1).map((l) => (
              <li key={l.turnoId}>
                <strong>{l.codigo}</strong>
                <span>{l.paciente}</span>
                <span className="tv-consultorio-min">{l.consultorio ?? l.prestador}</span>
              </li>
            ))}
          </ul>
        </section>

        {config.media && <FrameMultimedia config={config} />}

        {vivos.length > 0 && (
          <section className="tv-anuncios">
            {vivos.map((a) => (
              <div className="tv-anuncio" key={a.id}>
                {/* `alt` vacío: son decorativos, y esta pantalla no tiene usuario que
                    los navegue. Sin `loading="lazy"`: están a la vista y un hueco en la
                    pared no es aceptable. */}
                <img src={a.url} alt=""
                     onError={() => setCaidos((c) => [...c, a.id])} />
              </div>
            ))}
          </section>
        )}
      </div>

      {config.mensaje && <footer className="tv-pie">{config.mensaje}</footer>}
    </div>
  );
}

/**
 * RN-11.2 · Frame multimedia: canal en vivo de YouTube que se interrumpe cada N
 * minutos para presentar el video institucional COMPLETO, y luego vuelve al canal.
 *
 * Riesgo registrado en la reunión y aceptado por ambas partes: esta rotación no se
 * había construido antes. Aquí se implementa con la IFrame Player API, que es la
 * única forma de detectar el fin del video (evento ENDED) para retornar al canal.
 */
function FrameMultimedia({ config }: { config: ConfigPantalla }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [modo, setModo] = useState<'canal' | 'institucional'>('canal');
  const [indiceVideo, setIndiceVideo] = useState(0);

  const canal = interpretarYoutube(config.canalYoutube);
  const hayInstitucionales = config.videosPromo.length > 0;
  // Sin canal utilizable, los institucionales son lo único que hay que emitir.
  const enCanal = modo === 'canal' && canal.tipo !== 'invalida';

  useEffect(() => {
    if (!enCanal || !hayInstitucionales) return;
    const id = setTimeout(() => setModo('institucional'), config.intervaloInstitucionalMin * 60_000);
    return () => clearTimeout(id);
  }, [enCanal, config.intervaloInstitucionalMin, hayInstitucionales]);

  /*
   * El directo NO se puede montar con la API de IFrame: solo acepta `videoId`, y un
   * canal en vivo se embebe por `live_stream?channel=…`. Por eso el directo va como
   * iframe normal y solo los institucionales usan la API, que es la que avisa
   * cuando el video termina para volver al canal.
   */
  const videoId = extraerVideoId(config.videosPromo[indiceVideo] ?? '');
  const cuantos = config.videosPromo.length;

  useEffect(() => {
    const marco = contenedor.current;
    if (!marco || enCanal || !videoId) return;

    let vivo = true;
    let player: { destroy?: () => void } | null = null;

    const siguiente = () => {
      setIndiceVideo((i) => (i + 1) % Math.max(1, cuantos));
      setModo('canal');
    };

    const iniciar = () => {
      const YT = (window as unknown as { YT?: YtNamespace }).YT;
      if (!vivo || !YT?.Player) return;

      /*
       * Nodo propio y desechable para YouTube: `YT.Player` REEMPLAZA el elemento que
       * recibe por su iframe. Si le diéramos el div del ref, tras `destroy()` el ref
       * apuntaría a un nodo fuera del documento —frame en negro para siempre— y React
       * podría intentar quitar un hijo que ya no está. Así el ref siempre apunta a un
       * nodo que posee React, y YouTube siempre recibe uno que puede destruir.
       */
      const hueco = document.createElement('div');
      hueco.style.height = '100%';
      marco.replaceChildren(hueco);

      player = new YT.Player(hueco, {
        height: '100%',
        width: '100%',
        videoId,
        playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1 },
        events: {
          // ENDED = 0 · al terminar el institucional se vuelve al canal en vivo.
          onStateChange: (e: { data: number }) => { if (e.data === 0) siguiente(); },
          // Un video que no se puede reproducir no debe congelar la rotación.
          onError: siguiente,
        },
      });
    };

    void cargarApiYoutube().then(iniciar);

    /*
     * La limpieza sale del efecto y no del callback. Por la rama asíncrona, el valor
     * que devolvía `iniciar()` se lo tragaba `onYouTubeIframeAPIReady`: un reproductor
     * creado por esa vía no se destruía nunca.
     */
    return () => {
      vivo = false;
      player?.destroy?.();
      marco.replaceChildren();
    };
    /*
     * Las deps son el video concreto, no `config.videosPromo`: el array llegaba nuevo
     * en cada refetch de 60 s y rehacía el reproductor, así que un institucional más
     * largo que un minuto no alcanzaba jamás su evento de fin — que es lo único de lo
     * que depende RN-11.2 para volver al canal.
     */
  }, [enCanal, videoId, cuantos]);

  /*
   * Qué se emite, decidido en un solo sitio. Encadenar ternarios en el JSX dejaba
   * ramas inalcanzables sin que se notara.
   */
  const emitiendo: 'directo' | 'bucle' | 'institucional' | 'nada' =
    enCanal && canal.tipo === 'directo' ? 'directo'
    : enCanal && canal.tipo === 'video' ? 'bucle'
    : hayInstitucionales ? 'institucional'
    : 'nada';

  return (
    <section className="tv-media">
      {emitiendo === 'directo' && canal.tipo === 'directo' && (
        <iframe
          className="tv-frame"
          src={urlEmbedDirecto(canal.canalId)}
          title="Canal en vivo"
          allow="autoplay; encrypted-media"
          frameBorder={0}
        />
      )}
      {emitiendo === 'bucle' && canal.tipo === 'video' && (
        <iframe
          className="tv-frame"
          src={`https://www.youtube.com/embed/${canal.videoId}?autoplay=1&mute=1&controls=0&loop=1&playlist=${canal.videoId}`}
          title="Canal"
          allow="autoplay; encrypted-media"
          frameBorder={0}
        />
      )}
      {emitiendo === 'institucional' && <div ref={contenedor} className="tv-frame" />}
      {emitiendo === 'nada' && (
        /* Se dice qué falta. El hueco negro con el error de YouTube no lo sabe
           interpretar nadie en una sala de espera. */
        <div className="tv-frame tv-frame-vacio">
          <p>Canal de video sin configurar</p>
          {canal.tipo === 'invalida' && <small>{canal.motivo}</small>}
        </div>
      )}
      <span className="tv-media-etiqueta">
        {emitiendo === 'directo' ? 'En vivo' : 'Centro de Profesionales & Provivir'}
      </span>
    </section>
  );
}


interface YtNamespace {
  Player: new (el: HTMLElement, opciones: Record<string, unknown>) => { destroy?: () => void };
}

/**
 * El script de la API se carga UNA vez por documento.
 *
 * Antes se añadía en cada montaje del efecto: dos montajes antes de que resolviera
 * dejaban dos `<script>` pisándose el mismo `onYouTubeIframeAPIReady`, y el primero se
 * perdía en silencio.
 */
let apiYoutube: Promise<void> | null = null;
function cargarApiYoutube(): Promise<void> {
  apiYoutube ??= new Promise<void>((listo) => {
    if ((window as unknown as { YT?: YtNamespace }).YT?.Player) { listo(); return; }
    (window as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = () => listo();
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.body.appendChild(script);
  });
  return apiYoutube;
}

/** Acepta una URL completa de YouTube o directamente el id del video. */
function extraerVideoId(url: string): string {
  const r = interpretarYoutube(url);
  return r.tipo === 'video' ? r.videoId : '';
}

