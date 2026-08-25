import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type Articulo,
  type PreguntaPendiente,
  type ResumenConocimiento,
  type Servicio,
  type UsuarioSesion,
} from '../api';
import { ModalFichaComercial, tieneFicha } from '../componentes/FichaComercial';
import { Probador } from './conocimiento/Probador';
import { TablaArticulos } from './conocimiento/TablaArticulos';
import { FormArticulo } from './conocimiento/FormArticulo';
import { ImportarDocumento } from './conocimiento/ImportarDocumento';
import { PanelesIa } from './conocimiento/PanelesIa';

/**
 * RN-13 · Base de conocimiento del bot.
 *
 * Es la pantalla donde se decide qué le responde la plataforma a los pacientes, así
 * que lo primero que ofrece no es el listado sino el **probador**: permite ver qué
 * recuperaría el bot antes de que la pregunta la haga alguien de verdad.
 *
 * Debajo, lo que gobierna esa respuesta: los artículos, la ficha comercial de la
 * que salen las cifras (RN-13.1) y los parámetros de la IA.
 */
export function Conocimiento({ usuario, onNavegar }: {
  usuario: UsuarioSesion;
  onNavegar: (vista: 'bandeja') => void;
}) {
  const [resumen, setResumen] = useState<ResumenConocimiento | null>(null);
  const [articulos, setArticulos] = useState<Articulo[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [pendientes, setPendientes] = useState<PreguntaPendiente[]>([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const [editando, setEditando] = useState<{ id: string | null } | null>(null);
  const [importando, setImportando] = useState(false);
  const [fichaDe, setFichaDe] = useState<Servicio | null>(null);

  /**
   * Dos permisos distintos aunque hoy coincidan en el perfil de administración:
   * redactar artículos es `conocimiento.editar` y tocar el umbral es
   * `configuracion.editar`. El día que exista un perfil de redactor, la pantalla
   * ya lo soporta sin cambiarla.
   */
  const puedeEditarContenido = usuario.rol === 'admin';
  const puedeEditarParametros = usuario.rol === 'admin';

  const recargar = useCallback(() => {
    Promise.all([
      api.resumenConocimiento(),
      api.articulos(),
      api.servicios(true),
      api.preguntasPendientes(),
    ])
      .then(([r, a, s, p]) => { setResumen(r); setArticulos(a); setServicios(s); setPendientes(p); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(recargar, [recargar]);

  /** `fn` puede devolver su propio mensaje: el informe de la importación es la parte útil. */
  async function accion(fn: () => Promise<string | void>, exito?: string) {
    setError(''); setAviso('');
    try {
      const propio = await fn();
      setAviso(propio ?? exito ?? '');
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  if (!resumen) {
    return (
      <div className="vista">
        {error ? <div className="error" role="alert">{error}</div> : <p className="nota">Cargando…</p>}
      </div>
    );
  }

  const { articulos: conteo, parametros } = resumen;
  const categorias = [...new Set(articulos.map((a) => a.categoria))].sort();

  return (
    <div className="vista ancha">
      <header className="vista-cab">
        <div>
          <h2>Base de conocimiento</h2>
          <p className="nota">
            Lo que el bot responde antes de escalar. Si ninguna ficha cubre la pregunta,
            escala en vez de aproximar: nunca inventa horarios, precios ni indicaciones.
          </p>
        </div>
      </header>

      {error && <div className="error" role="alert">{error}</div>}
      {aviso && <div className="exito">{aviso}</div>}

      <div className="card plano" style={{ marginBottom: '1rem' }}>
        <div className="bd searchbar">
          <span className="tag t-green">🧠 RN-13</span>
          <span className="small muted" style={{ flex: 1 }}>
            El bot responde <b>solo</b> con lo que encuentre aquí; si no hay cobertura suficiente{' '}
            <b>escala, no improvisa</b>. Toda cifra —duración, cupos, costo— sale de la ficha del
            servicio, nunca del texto del artículo.
          </span>
        </div>
      </div>

      {/* ── Los cuatro indicadores, de una sola petición ── */}
      <div className="grid g4" style={{ marginBottom: '1rem' }}>
        <div className="card kpi accent">
          <div className="lb">Artículos publicados</div>
          <div className="vl">{conteo.publicados}</div>
          <div className="dt">
            {conteo.borradores} borrador · {conteo.archivados} archivado
            {conteo.archivados === 1 ? '' : 's'} · fuera del índice
          </div>
        </div>
        <div className="card kpi">
          <div className="lb">Resolución sin humano</div>
          <div className="vl">{resumen.resolucionSinHumano.porcentaje}%</div>
          <div className="dt">Meta progresiva 70–90% (RN-08.4)</div>
        </div>
        <div className="card kpi">
          <div className="lb">Preguntas sin respuesta</div>
          <div className="vl">{resumen.pendientesAbiertas}</div>
          <div className="dt">Cola de mejora (RN-13.6)</div>
        </div>
        <div className="card kpi">
          <div className="lb">Seguimientos activos</div>
          <div className="vl">{resumen.seguimientosActivos}</div>
          <div className="dt">Se gestionan en la bandeja (RN-09.9)</div>
        </div>
      </div>

      <div className="grid g2" style={{ marginBottom: '1rem' }}>
        <Probador servicios={servicios} umbral={parametros.umbral} />
        <PreguntasSinRespuesta
          pendientes={pendientes}
          soloLectura={!puedeEditarContenido}
          onCrear={(id) => accion(async () => {
            const borrador = await api.articuloDesdePendiente(id);
            // Abrirlo evita que quede un borrador vacío olvidado en la lista.
            setEditando({ id: borrador.id });
            return 'Borrador creado desde la pregunta. Complétalo y publícalo.';
          })}
          onDescartar={(id) => accion(async () => { await api.descartarPendiente(id); }, 'Pregunta descartada')}
        />
      </div>

      {conteo.requierenRevision > 0 && (
        <div className="card plano" style={{ marginBottom: '1rem' }}>
          <div className="bd aviso" style={{ margin: 0 }}>
            ⚠️ <b>{conteo.requierenRevision} artículo(s) marcado(s) para revisión</b> porque su
            servicio fue desactivado (RN-04.5.4). Revísalos y archívalos si ya no aplican: dejar
            viva la ficha de un servicio que no se presta es la forma más fácil de que el bot
            ofrezca algo inexistente.
          </div>
        </div>
      )}

      {importando && puedeEditarContenido && (
        <ImportarDocumento hayPublicados={conteo.publicados > 0} onCambio={recargar} />
      )}

      <TablaArticulos
        articulos={articulos}
        servicios={servicios}
        soloLectura={!puedeEditarContenido}
        onAccion={accion}
        onEditar={(id) => setEditando({ id })}
        onCrear={() => setEditando({ id: null })}
        onImportar={() => setImportando((v) => !v)}
      />

      <div className="grid g2">
        <FichaComercialServicios
          servicios={servicios}
          soloLectura={!puedeEditarContenido}
          onEditar={setFichaDe}
        />
        <PanelesIa
          resumen={resumen}
          editable={puedeEditarParametros}
          onAccion={accion}
          onIrABandeja={() => onNavegar('bandeja')}
        />
      </div>

      {editando && (
        <FormArticulo
          articuloId={editando.id}
          servicios={servicios}
          categorias={categorias}
          onCerrar={() => setEditando(null)}
          onGuardado={(mensaje) => { setEditando(null); setAviso(mensaje); recargar(); }}
        />
      )}

      {fichaDe && (
        <ModalFichaComercial
          servicio={fichaDe}
          onCerrar={() => setFichaDe(null)}
          onGuardado={() => {
            setFichaDe(null);
            setAviso(`Ficha de «${fichaDe.nombre}» actualizada. Tiene efecto inmediato en el bot.`);
            recargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * La cola de mejora (RN-13.6): lo que los pacientes preguntaron y el bot no supo
 * contestar, agrupado por frecuencia. Convertir las más repetidas en artículos es
 * lo que mueve la resolución automática hacia el 70–90%.
 */
function PreguntasSinRespuesta({ pendientes, soloLectura, onCrear, onDescartar }: {
  pendientes: PreguntaPendiente[];
  soloLectura: boolean;
  onCrear: (id: string) => void;
  onDescartar: (id: string) => void;
}) {
  return (
    <div className="card plano">
      <div className="hd">
        <h3>Preguntas sin respuesta</h3>
        <div className="spacer" />
        <span className="tag t-amber">{pendientes.length} abiertas</span>
      </div>

      <div className="bd small muted" style={{ paddingBottom: '.4rem' }}>
        Preguntas que escalaron porque ningún artículo las cubre, agrupadas y ordenadas por
        frecuencia. Convertirlas en artículos es lo que mueve la resolución automática hacia
        el 70–90% (RN-08.4).
      </div>

      {pendientes.length === 0 ? (
        <div className="bd">
          <p className="nota">
            Nada pendiente. Cuando alguien pregunte algo que la base no cubre, aparecerá aquí
            agrupado por frecuencia.
          </p>
        </div>
      ) : (
        <table className="tabla">
          <thead>
            <tr><th>Pregunta</th><th className="center">Veces</th><th className="right">Acción</th></tr>
          </thead>
          <tbody>
            {pendientes.map((p) => (
              <tr key={p.id}>
                <td className="small"><b>{p.preguntaEjemplo}</b></td>
                <td className="center">
                  <span className={`tag ${p.ocurrencias >= 6 ? 't-red' : 't-gray'}`}>{p.ocurrencias}</span>
                </td>
                <td className="right">
                  {soloLectura ? <span className="small muted">—</span> : (
                    <div className="acciones-fila" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-soft btn-sm" onClick={() => onCrear(p.id)}>
                        📝 Crear artículo
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => onDescartar(p.id)}>
                        Descartar
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * RN-04.5.1 · lo que el bot usa para vender.
 *
 * Está en esta pantalla porque es el primer sitio donde se mira cuando el bot dice
 * algo raro de un servicio: **las cifras se leen de aquí**, no del texto de los
 * artículos, así que un precio o una duración equivocados se corrigen acá.
 */
function FichaComercialServicios({ servicios, soloLectura, onEditar }: {
  servicios: Servicio[];
  soloLectura: boolean;
  onEditar: (s: Servicio) => void;
}) {
  return (
    <div className="card plano">
      <div className="hd">
        <h3>Ficha comercial de servicios</h3>
        <div className="spacer" />
        <span className="tag t-blue">P6</span>
      </div>

      <div className="bd small muted" style={{ paddingBottom: '.4rem' }}>
        Es lo que el bot usa para vender. <b>Las cifras se leen de aquí</b>, no del texto de los
        artículos: así el precio, la duración y los cupos nunca se inventan.
      </div>

      <div className="tabla-ancha">
      <table className="tabla">
        <thead>
          <tr>
            <th>Servicio</th><th>Beneficios que comunica el bot</th>
            <th className="center">Duración</th><th className="center">Agendable</th>
            <th className="right">Ficha</th>
          </tr>
        </thead>
        <tbody>
          {servicios.map((s) => (
            <tr key={s.id} style={s.activo === false ? { opacity: 0.55 } : undefined}>
              <td>
                <b>{s.nombre}</b>
                {s.activo === false && <span className="tag t-gray"> Inactivo</span>}
                <div className="small muted">{s.descripcionComercial ?? ''}</div>
                {!tieneFicha(s) && (
                  <span className="tag t-amber">Sin ficha · el bot no lo ofrece</span>
                )}
              </td>
              <td className="small">
                {(s.beneficios ?? []).map((b) => <div key={b}>• {b}</div>)}
                {s.preparacion && (
                  <div className="small muted" style={{ marginTop: '.3rem' }}>
                    🧾 <b>Preparación:</b> {s.preparacion}
                  </div>
                )}
              </td>
              <td className="center small">
                {s.duracionMin} min
                {s.cupos > 1 && <><br /><span className="tag t-blue">{s.cupos} cupos</span></>}
              </td>
              <td className="center">
                {s.agendable === false
                  ? <span className="tag t-gray">No</span>
                  : s.requiereOrden
                    ? <span className="tag t-amber">Con orden</span>
                    : <span className="tag t-green">Directo</span>}
              </td>
              <td className="right">
                {soloLectura
                  ? <span className="small muted">—</span>
                  : <button className="btn btn-ghost btn-sm" onClick={() => onEditar(s)}>✏️ Editar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="bd small muted">
        Editar la ficha tiene <b>efecto inmediato</b> en lo que responde el bot: no toca agendas,
        por eso no necesita periodo de gracia (RN-04.5.2). El alta y baja de servicios se hace
        en <b>Catálogo</b>.
      </div>
    </div>
  );
}
