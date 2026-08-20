import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    if (modo !== 'canal' || config.videosPromo.length === 0) return;
    const ms = config.intervaloInstitucionalMin * 60_000;
    const id = setTimeout(() => setModo('institucional'), ms);
    return () => clearTimeout(id);
  }, [modo, config.intervaloInstitucionalMin, config.videosPromo.length]);

  useEffect(() => {
    const contenedorActual = contenedor.current;
    if (!contenedorActual) return;

    // La API de IFrame se carga una sola vez por página.
    const iniciar = () => {
      const YT = (window as unknown as { YT?: YtNamespace }).YT;
      if (!YT?.Player) return;

      const esCanal = modo === 'canal';
      const player = new YT.Player(contenedorActual, {
        height: '100%',
        width: '100%',
        ...(esCanal
          ? { playerVars: { listType: 'user_uploads', autoplay: 1, mute: 1, controls: 0 } }
          : { videoId: extraerVideoId(config.videosPromo[indiceVideo] ?? ''), playerVars: { autoplay: 1, controls: 0 } }),
        events: {
          onStateChange: (e: { data: number }) => {
            // ENDED = 0 · al terminar el institucional se vuelve al canal en vivo.
            if (!esCanal && e.data === 0) {
              setIndiceVideo((i) => (i + 1) % Math.max(1, config.videosPromo.length));
              setModo('canal');
            }
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
  }, [modo, indiceVideo, config.videosPromo]);

  return (
    <section className="tv-media">
      <div ref={contenedor} className="tv-frame" />
      <span className="tv-media-etiqueta">
        {modo === 'canal' ? 'Noticias en vivo' : 'Grupo Provivir'}
      </span>
    </section>
  );
}

interface YtNamespace {
  Player: new (el: HTMLElement, opciones: Record<string, unknown>) => { destroy?: () => void };
}

/** Acepta una URL completa de YouTube o directamente el id del video. */
function extraerVideoId(url: string): string {
  const m = /(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m?.[1] ?? url;
}
