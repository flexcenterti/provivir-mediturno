import { io, type Socket } from 'socket.io-client';
import { refrescarSesion, token } from './api';

/**
 * Un solo socket para toda la consola.
 *
 * Singleton de módulo y no contexto de React, con la misma forma que `token`: si la
 * bandeja y el armazón abrieran cada uno el suyo serían dos conexiones y dos
 * autenticaciones por pestaña, y el servidor las cuenta.
 *
 * `socket.io-client` llevaba en el `package.json` desde la fase 3 sin que nadie lo
 * importara. La infraestructura del backend ya existía entera: la TV la usa, el
 * backoffice se conformaba con dos `setInterval`.
 */

type Escucha = (cantidad: number) => void;

let socket: Socket | null = null;
const escuchas = new Set<Escucha>();

/**
 * Se suscribe al pulso de la bandeja y devuelve cómo darse de baja.
 *
 * El evento `bandeja-pendientes` se usa como **pulso, no como dato**: solo trae un
 * número, pero lo emiten los nueve sitios que cambian algo —mensaje entrante,
 * escalado, cierre, y tomar/soltar/reabrir/responder/resolver—, así que sirve para
 * saber «algo cambió, vuelve a mirar». Incluido lo que hace otra asistente en otra
 * pestaña, que hoy no se ve hasta el siguiente sondeo.
 */
export function alPulsoDeBandeja(fn: Escucha): () => void {
  escuchas.add(fn);
  conectar();

  return () => {
    escuchas.delete(fn);
    // Nadie escuchando: se cierra en vez de dejar la conexión abierta de fondo.
    if (escuchas.size === 0) {
      socket?.disconnect();
      socket = null;
    }
  };
}

/** Si el socket está en pie. Quien sondea de respaldo baja el ritmo cuando sí lo está. */
export function hayTiempoReal(): boolean {
  return socket?.connected === true;
}

function conectar(): void {
  if (socket) return;

  socket = io('/tiempo-real', {
    transports: ['websocket'],
    // La sala reparte nombres de pacientes: el servidor exige sesión para entrar.
    auth: { token: token.leer() },
  });

  socket.on('connect', () => socket?.emit('suscribir-backoffice'));
  socket.on('bandeja-pendientes', ({ cantidad }: { cantidad: number }) => {
    for (const fn of escuchas) fn(cantidad);
  });

  /*
   * El token de acceso caduca en 15 minutos y socket.io reconecta solo — con el token
   * viejo, que es como no reconectar. Hay que refrescarlo y reasignarlo antes de que
   * lo intente otra vez.
   */
  socket.on('connect_error', () => {
    void refrescarSesion().then((ok) => {
      if (ok && socket) socket.auth = { token: token.leer() };
    });
  });
}
