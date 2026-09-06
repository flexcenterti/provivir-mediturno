import { useEffect, useState } from 'react';
import { api, fechaLarga, primeraFechaAgendable, type Confirmacion, type Cupo, type Servicio, type Ventana } from './api';

/** ¿La ventana deja fuera algún día intermedio? Si no, `min`/`max` ya la expresan entera. */
function huecosEnLaVentana(v: Ventana | null): boolean {
  if (!v || v.fechas.length === 0) return false;
  const dia = 86_400_000;
  const span = (Date.parse(`${v.fechas.at(-1)!}T00:00:00Z`) - Date.parse(`${v.fechas[0]!}T00:00:00Z`)) / dia + 1;
  return span !== v.fechas.length;
}

const diaCorto = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

type Paso = 'inicio' | 'registrado' | 'nuevo' | 'servicio' | 'cupos' | 'confirmada';

/**
 * Portal público de autoagendamiento (D4 / RN-10).
 *
 * Flujo SIN IA, de selección simple. Los cupos vienen del motor: esta pantalla
 * no calcula ninguna regla de agendamiento.
 */
export function App() {
  const [paso, setPaso] = useState<Paso>('inicio');
  const [sesion, setSesion] = useState('');
  const [nombre, setNombre] = useState('');
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [servicioId, setServicioId] = useState('');
  const [fecha, setFecha] = useState(primeraFechaAgendable());
  const [cupos, setCupos] = useState<Cupo[]>([]);
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [ventana, setVentana] = useState<Ventana | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { api.servicios().then(setServicios).catch(() => undefined); }, []);

  /*
   * RN-04.8 · La ventana la calcula el motor y el portal solo la pinta. Si la
   * petición falla se queda en `null`, que es el comportamiento de antes: el
   * selector vuelve a abrirse desde mañana y el motor sigue rechazando lo que no
   * corresponda. Ningún límite de esta pantalla es una garantía.
   */
  useEffect(() => {
    api.ventana()
      .then((v) => {
        setVentana(v);
        const primera = v?.fechas[0];
        if (primera) setFecha(primera);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (paso !== 'cupos' || !servicioId) return;
    setError('');
    // RN-10.5 · con la sesión, el motor avisa de que ya hay cita ese día en vez de
    // dejar que el paciente elija una hora y se la rechacen al confirmar.
    api.cupos(servicioId, fecha, sesion)
      .then(setCupos)
      .catch((e: Error) => { setCupos([]); setError(e.message); });
  }, [paso, servicioId, fecha, sesion]);

  function entrar(s: string, n: string) {
    setSesion(s); setNombre(n); setPaso('servicio'); setError('');
  }

  async function agendar(cupo: Cupo) {
    setOcupado(true); setError('');
    try {
      const r = await api.agendar({
        sesion, servicioId, fecha, hora: cupo.hora, prestadorId: cupo.prestadorId,
      });
      if (r.creada && r.confirmacion) {
        setConfirmacion(r.confirmacion);
        setPaso('confirmada');
      } else {
        setError(r.motivo ?? 'Ese horario acaba de ocuparse. Elige otro.');
        setCupos(r.alternativas ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setOcupado(false);
    }
  }

  const servicio = servicios.find((s) => s.id === servicioId);

  return (
    <div className="portal">
      <header className="p-cab">
        <div className="brand-mark">CPP</div>
        <div>
          <strong>Centro de Profesionales & Provivir</strong>
          <span>CPP Principal</span>
        </div>
      </header>

      <main className="p-main">
        {/* role="alert" lo anuncia el lector de pantalla al aparecer. Sin esto, quien
            no ve la pantalla rellena el formulario, falla y no se entera de por qué. */}
        {error && <div className="error" role="alert">{error}</div>}

        {paso === 'inicio' && (
          <section className="p-inicio">
            <h1>Agenda tu cita</h1>
            <p className="p-sub">Selecciona una opción para comenzar</p>
            <button className="p-grande" onClick={() => setPaso('registrado')}>
              <strong>Ya soy paciente</strong>
              <span>Tengo historia en la clínica</span>
            </button>
            <button className="p-grande" onClick={() => setPaso('nuevo')}>
              <strong>Soy paciente nuevo</strong>
              <span>Es mi primera vez aquí</span>
            </button>
          </section>
        )}

        {paso === 'registrado' && <Identificar onListo={entrar} onVolver={() => setPaso('inicio')} onError={setError} />}
        {paso === 'nuevo' && <Registrar onListo={entrar} onVolver={() => setPaso('inicio')} onError={setError} />}

        {paso === 'servicio' && (
          <section className="p-paso">
            <h2>Hola, {nombre}</h2>
            <p className="p-sub">¿Qué servicio necesitas?</p>
            <div className="p-servicios">
              {/*
                RN-04.7 · Los que coordina la asistente se muestran igual, pero sin
                horarios. Ocultarlos haría creer que la clínica no los presta; dejarlos
                seleccionables llevaría al paciente a una pantalla vacía.
              */}
              {servicios.map((s) => (
                <button key={s.id} disabled={!s.agendable}
                        className={`p-servicio ${servicioId === s.id ? 'sel' : ''} ${s.agendable ? '' : 'p-no-agendable'}`}
                        onClick={() => setServicioId(s.id)}>
                  <strong>{s.nombre}</strong>
                  <span>{s.categoria} · {s.duracionMin} min</span>
                  {s.requiereOrden && <span className="p-aviso">Requiere orden médica</span>}
                  {!s.agendable && <span className="p-aviso">Se agenda con una asistente</span>}
                </button>
              ))}
            </div>
            <button className="btn btn-primary" disabled={!servicioId} onClick={() => setPaso('cupos')}>
              Continuar
            </button>
          </section>
        )}

        {paso === 'cupos' && (
          <section className="p-paso">
            <h2>{servicio?.nombre}</h2>
            <label className="p-fecha">
              Fecha
              <input id="fecha" type="date" value={fecha}
                     min={ventana?.fechas[0] ?? primeraFechaAgendable()}
                     max={ventana?.fechas.at(-1)}
                     onChange={(e) => setFecha(e.target.value)} />
            </label>
            <p className="p-sub">{fechaLarga(fecha)}</p>
            {/*
              * Entre el primer y el último día de la ventana puede haber huecos —un
              * sábado excluido, un festivo—, y un `<input type="date">` no sabe
              * deshabilitar días sueltos. Cuando los hay se listan, que es lo único
              * que evita que el paciente elija un día que el motor va a rechazar.
              */}
            {huecosEnLaVentana(ventana) && (
              <p className="p-sub">Por aquí solo se puede reservar el {ventana!.fechas.map(diaCorto).join(', ')}.</p>
            )}

            <div className="p-cupos">
              {cupos.map((c, i) => (
                <button key={`${c.prestadorId}-${c.hora}-${i}`} className="p-cupo" disabled={ocupado}
                        onClick={() => agendar(c)}>
                  <strong>{c.hora}</strong>
                  <span>{c.prestadorNombre}</span>
                </button>
              ))}
              {cupos.length === 0 && !error && (
                <p className="p-sub">
                  No hay horarios disponibles ese día. Prueba otra fecha.
                  {ventana && ` Ten en cuenta que por aquí solo se reservan citas entre las ${ventana.horarioCita.desde} y las ${ventana.horarioCita.hasta}; para otra hora, comunícate con la clínica.`}
                </p>
              )}
            </div>

            <button className="btn btn-ghost" onClick={() => setPaso('servicio')}>Cambiar servicio</button>
          </section>
        )}

        {paso === 'confirmada' && confirmacion && <Confirmada c={confirmacion} />}
      </main>

      <AvisoPrivacidad />
    </div>
  );
}

function Identificar({ onListo, onVolver, onError }: {
  onListo: (sesion: string, nombre: string) => void; onVolver: () => void; onError: (m: string) => void;
}) {
  const [documento, setDocumento] = useState('');
  const [ultimos4, setUltimos4] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault(); setOcupado(true); onError('');
    try {
      const r = await api.identificar(documento.trim(), ultimos4.trim());
      onListo(r.sesion, r.paciente.nombres);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally { setOcupado(false); }
  }

  return (
    <form className="p-paso" onSubmit={enviar}>
      <h2>Identifícate</h2>
      <div className="field">
        <label htmlFor="doc">Número de documento</label>
        <input id="doc" value={documento} onChange={(e) => setDocumento(e.target.value)} inputMode="numeric" required />
      </div>
      <div className="field">
        <label htmlFor="ult4">Últimos 4 dígitos de tu teléfono</label>
        <input id="ult4" value={ultimos4} onChange={(e) => setUltimos4(e.target.value)}
               inputMode="numeric" maxLength={4} required />
        <span className="p-ayuda">Nos ayuda a confirmar que eres tú.</span>
      </div>
      <button className="btn btn-primary" type="submit" disabled={ocupado}>
        {ocupado ? 'Verificando…' : 'Continuar'}
      </button>
      <button className="btn btn-ghost" type="button" onClick={onVolver}>Volver</button>
    </form>
  );
}

function Registrar({ onListo, onVolver, onError }: {
  onListo: (sesion: string, nombre: string) => void; onVolver: () => void; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ documento: '', nombres: '', apellidos: '', telefono: '' });
  const [acepta, setAcepta] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault(); setOcupado(true); onError('');
    try {
      const r = await api.registrar(f);
      onListo(r.sesion, r.paciente.nombres);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Error');
    } finally { setOcupado(false); }
  }

  // El `htmlFor` no es adorno: sin él el lector de pantalla no anuncia la etiqueta
  // al enfocar el campo, y tocarla no enfoca nada. Es un formulario público.
  const campo = (k: keyof typeof f, etiqueta: string, extra?: object) => (
    <div className="field">
      <label htmlFor={`r-${k}`}>{etiqueta}</label>
      <input id={`r-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required {...extra} />
    </div>
  );

  return (
    <form className="p-paso" onSubmit={enviar}>
      <h2>Tus datos</h2>
      {campo('documento', 'Número de documento', { inputMode: 'numeric' })}
      {campo('nombres', 'Nombres')}
      {campo('apellidos', 'Apellidos')}
      {campo('telefono', 'Teléfono / WhatsApp', { inputMode: 'tel' })}

      {/* Ley 1581/2012 · consentimiento explícito antes de guardar datos personales */}
      <label className="p-check">
        <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} />
        Autorizo el tratamiento de mis datos personales para la gestión de mis citas,
        conforme al aviso de privacidad.
      </label>

      <button className="btn btn-primary" type="submit" disabled={!acepta || ocupado}>
        {ocupado ? 'Registrando…' : 'Continuar'}
      </button>
      <button className="btn btn-ghost" type="button" onClick={onVolver}>Volver</button>
    </form>
  );
}

function Confirmada({ c }: { c: Confirmacion }) {
  return (
    <section className="p-paso p-confirmada">
      <div className="p-ok">✓</div>
      <h2>Tu cita quedó agendada</h2>
      <div className="p-codigo">{c.codigo}</div>
      <p className="p-sub">Guarda este código de atención</p>

      <dl className="p-detalle">
        <dt>Paciente</dt><dd>{c.paciente}</dd>
        <dt>Servicio</dt><dd>{c.servicio}</dd>
        <dt>Profesional</dt><dd>{c.prestador}</dd>
        <dt>Fecha</dt><dd>{fechaLarga(c.fecha)}</dd>
        <dt>Hora</dt><dd>{c.hora}</dd>
      </dl>

      <p className="p-indicaciones">{c.indicaciones}</p>
      <p className="p-sub">También te enviaremos la confirmación por WhatsApp.</p>
      <button className="btn btn-ghost" onClick={() => location.reload()}>Agendar otra cita</button>
    </section>
  );
}

function AvisoPrivacidad() {
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<Awaited<ReturnType<typeof api.aviso>> | null>(null);

  useEffect(() => { if (abierto && !aviso) api.aviso().then(setAviso).catch(() => undefined); }, [abierto, aviso]);

  return (
    <footer className="p-pie">
      <button onClick={() => setAbierto(!abierto)}>Aviso de privacidad</button>
      {abierto && aviso && (
        <div className="p-aviso-texto">
          <p><strong>Responsable:</strong> {aviso.responsable}</p>
          <p><strong>Finalidad:</strong> {aviso.finalidad}</p>
          <p><strong>Tus derechos:</strong> {aviso.derechos}</p>
          <p className="muted">{aviso.base}</p>
        </div>
      )}
    </footer>
  );
}
