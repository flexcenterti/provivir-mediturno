import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './estilos.css';

/**
 * Un error de render en un kiosko no tiene quien lo recoja.
 *
 * Sin esto, cualquier excepción deja el televisor **en blanco**, que desde la sala es
 * indistinguible de un aparato averiado: nadie va a abrir la consola, y a menudo nadie
 * puede ni pulsar F5. Por eso además de decirlo se recarga sola — es la única
 * pantalla del producto sin un usuario delante.
 */
class Barrera extends React.Component<{ children: React.ReactNode }, { roto: boolean }> {
  state = { roto: false };

  static getDerivedStateFromError() {
    return { roto: true };
  }

  componentDidCatch(error: Error) {
    console.error('La pantalla de sala falló', error);
    setTimeout(() => location.reload(), 30_000);
  }

  render() {
    if (!this.state.roto) return this.props.children;
    return (
      <div className="tv-error">
        La pantalla tuvo un problema y se reiniciará sola en unos segundos.
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Barrera>
      <App />
    </Barrera>
  </React.StrictMode>,
);
