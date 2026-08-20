/**
 * Pantalla de sala en modo kiosk (RN-11). Ruta final: /tv/:pantallaId.
 * Se construye en la Fase 3, con WebSocket de llamados y frame de YouTube.
 */
export function App() {
  return (
    <div className="panel">
      <h1>Pantalla de sala</h1>
      <div className="card">
        <p>Grupo Provivir · CDC Oriente</p>
        <p style={{ marginTop: '1rem', color: 'var(--muted)', fontSize: '.86rem' }}>
          Llamados en tiempo real y frame multimedia — Fase 3.
        </p>
      </div>
    </div>
  );
}
