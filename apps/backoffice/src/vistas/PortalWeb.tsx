import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * RN-10 · Autoagendamiento web.
 *
 * El QR ya lo generaba la API desde la Fase 5 (`GET /api/portal/qr.png`, ruta
 * pública) y no lo pedía ninguna pantalla, así que imprimirlo obligaba a llamar al
 * endpoint a mano. Aquí se ve, se descarga y se comprueba que apunta a donde debe.
 */
const QR = '/api/portal/qr.png';

export function PortalWeb() {
  const [enlace, setEnlace] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.enlacePortal().then((r) => setEnlace(r.url)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="vista">
      {error && <div className="error">{error}</div>}

      <div className="grid g2">
        <div className="card plano">
          <div className="hd">
            <h3>Portal público de autoagendamiento</h3>
            <div className="spacer" />
            <span className="tag t-green">Activo</span>
          </div>
          <div className="bd">
            <div className="ia-panel">
              <div className="row">
                <span className="muted">Enlace público</span>
                <b>{enlace || '—'}</b>
              </div>
              <div className="row">
                <span className="muted">Inserción en la web</span>
                <b>grupoprovivir.com (iframe / botón)</b>
              </div>
              <div className="row">
                <span className="muted">Flujo</span>
                <b>Selección simple · sin IA</b>
              </div>
              <div className="row">
                <span className="muted">Confirmación</span>
                <b>Código de atención + WhatsApp (RN-10.3)</b>
              </div>
              <div className="row">
                <span className="muted">Pacientes nuevos</span>
                <b>Alta con datos demográficos básicos</b>
              </div>
            </div>

            <div className="chips" style={{ marginTop: '1rem' }}>
              <a
                className="btn btn-primary btn-sm"
                href={enlace || '#'}
                target="_blank"
                rel="noopener noreferrer"
              >
                🌐 Abrir el portal
              </a>
              {/* Tamaño de impresión: 1200 px es el tope que admite el endpoint. */}
              <a className="btn btn-soft btn-sm" href={`${QR}?tamano=1200`} download="qr-provivir.png">
                ⬇️ Descargar QR para imprimir
              </a>
            </div>

            <p className="nota" style={{ marginTop: '.9rem' }}>
              El enlace se fija con <code>PORTAL_URL</code> en el servidor, no desde esta pantalla:
              cambiarlo invalida los carteles y los QR ya impresos.
            </p>
          </div>
        </div>

        <div className="card plano">
          <div className="hd"><h3>QR para la sede</h3></div>
          <div className="bd center">
            <img
              src={`${QR}?tamano=512`}
              alt="Código QR del portal de autoagendamiento"
              width={220}
              height={220}
              style={{ maxWidth: '100%', height: 'auto', borderRadius: '12px', border: '1px solid var(--line)' }}
            />
            <p className="small muted" style={{ marginTop: '.8rem' }}>
              El paciente en la cola escanea el código, autogestiona su cita desde el celular
              y se retira (RN-10.1).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
