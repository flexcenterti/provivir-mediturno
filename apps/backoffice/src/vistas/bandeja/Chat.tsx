import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { etiquetaDeDia } from '@provivir/shared';
import { api, type MensajeConversacion } from '../../api';

/** Quién escribió un saliente. Vacío = no fue una persona. */
export function firma(autor: { nombre: string } | null, tipo: string): string {
  if (autor) return autor.nombre;
  return tipo === 'plantilla' ? 'Automático' : 'Asistente virtual';
}

/** A qué distancia del fondo se considera que el usuario «está al día». */
const PEGADO_AL_FONDO_PX = 80;

/**
 * El hilo, con sus separadores de día y su desplazamiento automático.
 *
 * El auto-scroll tiene dos comportamientos a propósito. Al cambiar de conversación
 * salta al final sin más: nadie abre un hilo para leer el principio. Pero cuando llega
 * un mensaje nuevo solo baja **si ya estabas al día** — si estabas leyendo historial,
 * arrancarte la vista es hostil, y con el refresco en vivo pasaría cada pocos minutos.
 * En ese caso aparece una píldora para bajar cuando quieras.
 */
export function Chat({ conversacionId, mensajes }: {
  conversacionId: string;
  mensajes: MensajeConversacion[];
}) {
  const caja = useRef<HTMLDivElement>(null);
  const pegado = useRef(true);
  const [hayNuevo, setHayNuevo] = useState(false);
  const cuantos = useRef(mensajes.length);

  const alFondo = (suave = false) => {
    const el = caja.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' });
    setHayNuevo(false);
  };

  // Al abrir otra conversación: al final, sin animación y antes de pintar.
  useLayoutEffect(() => {
    pegado.current = true;
    cuantos.current = mensajes.length;
    alFondo();
    // Solo el id, a propósito: lo que reinicia la posición es cambiar de hilo. Que
    // lleguen mensajes lo gobierna el efecto de abajo, que respeta si estabas leyendo.
  }, [conversacionId]);

  useEffect(() => {
    if (mensajes.length === cuantos.current) return;
    cuantos.current = mensajes.length;
    if (pegado.current) alFondo(true);
    else setHayNuevo(true);
  }, [mensajes.length]);

  const alDesplazar = () => {
    const el = caja.current;
    if (!el) return;
    pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < PEGADO_AL_FONDO_PX;
    if (pegado.current) setHayNuevo(false);
  };

  const ahora = new Date();
  let diaPrevio = '';

  return (
    <div className="chat" ref={caja} onScroll={alDesplazar}>
      {mensajes.map((m) => {
        const ts = new Date(m.ts);
        const dia = etiquetaDeDia(ts, ahora);
        const cambiaDia = dia !== diaPrevio;
        diaPrevio = dia;

        return (
          <Fragment key={m.id}>
            {cambiaDia && <div className="chat-dia"><span className="pill">{dia}</span></div>}
            <div className={`burbuja ${m.direccion === 'entrante' ? 'de-paciente' : 'de-clinica'}`}>
              {/* RN-08.1 · el adjunto del paciente se le muestra a la asistente como soporte */}
              {m.mediaPath && <Adjunto mensajeId={m.id} tipo={m.tipo} nombre={m.contenido} />}
              <span>{m.transcripcion ?? m.contenido ?? (m.mediaPath ? '' : `[${m.tipo}]`)}</span>
              <time>
                {/* Quién lo escribió: antes el bot y una persona eran indistinguibles. */}
                {m.direccion === 'saliente' && <>{firma(m.autor, m.tipo)} · </>}
                {ts.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
              </time>
            </div>
          </Fragment>
        );
      })}

      {hayNuevo && (
        <button className="btn btn-sm btn-primary chat-nuevo" onClick={() => alFondo(true)}>
          ↓ Mensaje nuevo
        </button>
      )}
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
