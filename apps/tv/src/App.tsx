import { useEffect, useRef, useState } from 'react';
import { interpretarYoutube, urlEmbedDirecto } from '@provivir/shared';
import { io, type Socket } from 'socket.io-client';

interface Llamado {
  codigo: string;
  paciente: string;
  prestador: string;
  consultorio: string | null;
  ts: string;
}

interface ConfigPantalla {
  id: string;
  nombre: string;
  turnosVisibles: number;
  sonido: boolean;
  mensaje: string | null;
  media: boolean;
  canalYoutube: string | null;
  videosPromo: string[];
  intervaloInstitucionalMin: number;
}

/**
 * RN-11 · Pantalla de sala en modo kiosk. Ruta final: /tv/:pantallaId.
 * El id de pantalla viene por query (?pantalla=…) para no depender de un router.
 */
export function App() {
  const pantallaId = new URLSearchParams(location.search).get('pantalla') ?? '';
  const [config, setConfig] = useState<ConfigPantalla | null>(null);
  const [llamados, setLlamados] = useState<Llamado[]>([]);
  const [error, setError] = useState('');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!pantallaId) { setError('Falta el parámetro ?pantalla=<id>'); return; }

    const cargar = () =>
      fetch(`/api/pantallas/${pantallaId}/estado`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Pantalla no encontrada'))))
        .then((d) => { setConfig(d.pantalla); setLlamados(d.llamados); })
        .catch((e: Error) => setError(e.message));

    void cargar();

    // Llamados en vivo por WebSocket; el fetch periódico es la red de seguridad
    // si la TV pierde la conexión un rato.
    const socket = io('/tiempo-real', { transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('suscribir-pantalla', pantallaId));
    socket.on('llamado', (l: Llamado) => setLlamados((prev) => [l, ...prev].slice(0, 12)));

    const id = setInterval(cargar, 60_000);
    return () => { socket.disconnect(); clearInterval(id); };
  }, [pantallaId]);

  if (error) return <div className="tv-error">{error}</div>;
  if (!config) return <div className="tv-error">Conectando…</div>;

  const visibles = llamados.slice(0, config.turnosVisibles);
  const actual = visibles[0];

  return (
    <div className="tv">
      <header className="tv-cab">
        <div className="brand-mark">GP</div>
        <h1>Grupo Provivir · CDC Oriente</h1>
        <span className="tv-sala">{config.nombre}</span>
      </header>

      <div className="tv-cuerpo">
        <section className="tv-turnos">
          {actual ? (
            <div className="tv-actual">
              <span className="tv-etiqueta">Turno en atención</span>
              <strong className="tv-codigo">{actual.codigo}</strong>
              <span className="tv-paciente">{actual.paciente}</span>
              <span className="tv-consultorio">{actual.consultorio ?? actual.prestador}</span>
            </div>
          ) : (
            <div className="tv-actual"><span className="tv-etiqueta">Esperando llamados</span></div>
          )}

          <ul className="tv-lista">
            {visibles.slice(1).map((l, i) => (
              <li key={`${l.codigo}-${i}`}>
                <strong>{l.codigo}</strong>
                <span>{l.paciente}</span>
                <span className="tv-consultorio-min">{l.consultorio ?? l.prestador}</span>
              </li>
            ))}
          </ul>
        </section>

        {config.media && <FrameMultimedia config={config} />}
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
  useEffect(() => {
    const el = contenedor.current;
    if (!el || enCanal) return;

    const videoId = extraerVideoId(config.videosPromo[indiceVideo] ?? '');
    if (!videoId) return;

    const iniciar = () => {
      const YT = (window as unknown as { YT?: YtNamespace }).YT;
      if (!YT?.Player) return;
      const player = new YT.Player(el, {
        height: '100%',
        width: '100%',
        videoId,
        playerVars: { autoplay: 1, mute: 1, controls: 0, rel: 0, playsinline: 1 },
        events: {
          onStateChange: (e: { data: number }) => {
            // ENDED = 0 · al terminar el institucional se vuelve al canal en vivo.
            if (e.data === 0) {
              setIndiceVideo((i) => (i + 1) % Math.max(1, config.videosPromo.length));
              setModo('canal');
            }
          },
          // Un video que no se puede reproducir no debe congelar la rotación.
          onError: () => {
            setIndiceVideo((i) => (i + 1) % Math.max(1, config.videosPromo.length));
            setModo('canal');
          },
        },
      });
      return () => player.destroy?.();
    };

    if ((window as unknown as { YT?: YtNamespace }).YT?.Player) return iniciar();

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    (window as unknown as { onYouTubeIframeAPIReady?: () => void }).onYouTubeIframeAPIReady = iniciar;
    document.body.appendChild(script);
  }, [enCanal, indiceVideo, config.videosPromo]);

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
        {emitiendo === 'directo' ? 'En vivo' : 'Grupo Provivir'}
      </span>
    </section>
  );
}


interface YtNamespace {
  Player: new (el: HTMLElement, opciones: Record<string, unknown>) => { destroy?: () => void };
}

/** Acepta una URL completa de YouTube o directamente el id del video. */
function extraerVideoId(url: string): string {
  const r = interpretarYoutube(url);
  return r.tipo === 'video' ? r.videoId : '';
}

