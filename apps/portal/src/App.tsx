/**
 * Portal público de autoagendamiento (RN-10 / D4).
 * Se construye en la Fase 5. Sin IA: selección simple, con aviso de privacidad Ley 1581.
 */
export function App() {
  return (
    <div className="panel">
      <h1>Agenda tu cita</h1>
      <div className="card">
        <p>Grupo Provivir · CDC Oriente</p>
        <p style={{ marginTop: '1rem', color: 'var(--muted)', fontSize: '.86rem' }}>
          Portal de autoagendamiento — Fase 5.
        </p>
      </div>
    </div>
  );
}
