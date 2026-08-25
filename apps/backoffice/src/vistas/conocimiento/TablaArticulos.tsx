import { useState } from 'react';
import { api, type Articulo, type Servicio } from '../../api';
import { extracto, fechaCorta } from './cta';

/**
 * Listado de artículos con su ciclo de vida (RN-13.5).
 *
 * Los dos modales explican por qué el sistema se comporta como se comporta.
 * No es decoración: archivar y borrar se parecen desde fuera y sus consecuencias
 * no tienen nada que ver, así que la diferencia se explica antes de ejecutarla.
 */
export function TablaArticulos({
  articulos, servicios, soloLectura, onAccion, onEditar, onCrear, onImportar,
}: {
  articulos: Articulo[];
  servicios: Servicio[];
  soloLectura: boolean;
  onAccion: (fn: () => Promise<string | void>, exito?: string) => void;
  onEditar: (id: string) => void;
  onCrear: () => void;
  onImportar: () => void;
}) {
  const [aArchivar, setAArchivar] = useState<Articulo | null>(null);
  const [aEliminar, setAEliminar] = useState<Articulo | null>(null);

  const nombreServicio = (id: string | null) => servicios.find((s) => s.id === id)?.nombre ?? null;

  return (
    <div className="card plano" style={{ marginBottom: '1rem' }}>
      <div className="hd">
        <h3>Artículos de conocimiento</h3>
        <div className="spacer" />
        {soloLectura ? (
          <span className="tag t-gray">Solo lectura · publica administración (RN-13.7)</span>
        ) : (
          <>
            <button className="btn btn-soft btn-sm" onClick={onImportar}>📤 Importar documento</button>
            <button className="btn btn-primary btn-sm" onClick={onCrear}>➕ Crear</button>
          </>
        )}
      </div>

      {articulos.length === 0 ? (
        <div className="bd">
          <p className="nota">
            Todavía no hay artículos. Mientras la base esté vacía, el bot usa el bloque de
            documentación comercial que está en Administración → Reglas.
          </p>
        </div>
      ) : (
        <div className="tabla-ancha">
        <table className="tabla">
          <thead>
            <tr>
              <th>Título</th><th>Categoría</th><th>Servicio vinculado</th>
              <th>Estado</th><th className="center">Versión</th><th>Actualizado</th>
              <th className="right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {articulos.map((a) => (
              <tr key={a.id} className={a.estado === 'archivado' ? 'inactiva' : ''}>
                <td>
                  <b className={soloLectura ? undefined : 'link-articulo'}
                     onClick={soloLectura ? undefined : () => onEditar(a.id)}
                     style={soloLectura ? undefined : { cursor: 'pointer' }}>
                    {a.titulo}
                  </b>
                  <div className="small muted">{extracto(a.contenidoMd)}</div>
                </td>
                <td><span className="tag t-teal">{a.categoria}</span></td>
                <td className="small">
                  {nombreServicio(a.servicioId) ?? <span className="muted">General</span>}
                </td>
                <td>
                  <EstadoArticulo estado={a.estado} />
                  {a.requiereRevision && (
                    <>
                      <br />
                      <span className="tag t-amber" style={{ marginTop: '.2rem' }}>Revisar</span>
                    </>
                  )}
                </td>
                <td className="center small">v{a.version}</td>
                <td className="small muted">{fechaCorta(a.actualizadoEn)}</td>
                <td className="right">
                  {soloLectura ? <span className="small muted">—</span> : (
                    <div className="acciones-fila" style={{ justifyContent: 'flex-end' }}>
                      {a.estado === 'borrador' && (
                        <>
                          <button className="btn btn-green btn-sm"
                                  onClick={() => onAccion(async () => { await api.publicarArticulo(a.id); },
                                    `«${a.titulo}» publicado. Reindexado en cola: el bot ya lo puede citar.`)}>
                            Publicar
                          </button>
                          <button className="btn btn-danger btn-sm" title="Solo los borradores pueden eliminarse"
                                  onClick={() => setAEliminar(a)}>🗑</button>
                        </>
                      )}
                      {a.estado === 'publicado' && (
                        <>
                          <button className="btn btn-amber btn-sm" onClick={() => setAArchivar(a)}>
                            📥 Archivar
                          </button>
                          <button className="btn btn-ghost btn-sm" title="Un artículo publicado no puede eliminarse"
                                  onClick={() => setAEliminar(a)}>🗑</button>
                        </>
                      )}
                      {a.estado === 'archivado' && (
                        <button className="btn btn-soft btn-sm"
                                onClick={() => onAccion(async () => { await api.reactivarArticulo(a.id); },
                                  `«${a.titulo}» volvió a borrador. Revísalo y publícalo para que el bot lo use.`)}>
                          ↺ Reactivar
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      <div className="bd small muted">
        Un artículo en <b>borrador</b> nunca se le sirve al bot (RN-13.7.1). Al publicar se encola
        el reindexado; hasta que termine sigue vigente la versión anterior. Los que ya no aplican
        se <b>archivan</b> —salen del índice al instante y se conservan para la auditoría—; solo
        los borradores admiten borrado definitivo.
      </div>

      {aArchivar && (
        <ModalArchivar
          articulo={aArchivar}
          onCerrar={() => setAArchivar(null)}
          onConfirmar={() => {
            const a = aArchivar;
            setAArchivar(null);
            onAccion(async () => { await api.archivarArticulo(a.id); },
              `«${a.titulo}» archivado. Salió del índice: el bot ya no lo cita. La ficha se conserva.`);
          }}
        />
      )}

      {aEliminar && (
        <ModalEliminar
          articulo={aEliminar}
          onCerrar={() => setAEliminar(null)}
          onArchivarEnSuLugar={() => { const a = aEliminar; setAEliminar(null); setAArchivar(a); }}
          onConfirmar={() => {
            const a = aEliminar;
            setAEliminar(null);
            onAccion(async () => { await api.eliminarArticulo(a.id); }, `Borrador «${a.titulo}» eliminado.`);
          }}
        />
      )}
    </div>
  );
}

function EstadoArticulo({ estado }: { estado: Articulo['estado'] }) {
  if (estado === 'publicado') return <span className="tag t-green">Publicado</span>;
  if (estado === 'borrador') return <span className="tag t-amber">Borrador</span>;
  return <span className="tag t-gray">Archivado</span>;
}

function ModalArchivar({ articulo, onCerrar, onConfirmar }: {
  articulo: Articulo; onCerrar: () => void; onConfirmar: () => void;
}) {
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Archivar · {articulo.titulo}</h3>
        <p className="small">
          Archivar <b>retira el artículo del índice en el acto</b>: el bot deja de recuperarlo desde
          este mismo momento, sin una ventana en la que siga respondiendo con información vieja.
        </p>
        <p className="small" style={{ marginTop: '.6rem' }}>
          El artículo <b>no se borra</b>. Se conserva porque la auditoría debe poder explicar las
          respuestas que el bot ya dio con él — que es justo lo que hace falta cuando un paciente
          reclama una respuesta incorrecta (RN-13.5).
        </p>
        <p className="small" style={{ marginTop: '.6rem' }}>
          Si más adelante vuelve a aplicar, reactivarlo lo devuelve a <b>borrador</b> para obligar a
          revisarlo antes de que circule otra vez.
        </p>
        <div className="acciones" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-amber" onClick={onConfirmar}>📥 Archivar artículo</button>
        </div>
      </div>
    </div>
  );
}

/**
 * RN-13.5.4 · el backend ya rechaza borrar lo publicado; esto explica el porqué
 * antes de gastar el viaje, y ofrece la acción que sí corresponde.
 */
function ModalEliminar({ articulo, onCerrar, onConfirmar, onArchivarEnSuLugar }: {
  articulo: Articulo; onCerrar: () => void; onConfirmar: () => void; onArchivarEnSuLugar: () => void;
}) {
  if (articulo.estado !== 'borrador') {
    const publicado = articulo.estado === 'publicado';
    return (
      <div className="modal-fondo" onClick={onCerrar}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>No se puede eliminar · {articulo.titulo}</h3>
          <p className="small">
            Solo se eliminan definitivamente los <b>borradores</b>, porque nunca sustentaron una
            respuesta del bot.
          </p>
          <p className="small" style={{ marginTop: '.6rem' }}>
            Este artículo {publicado ? 'está publicado' : 'estuvo publicado'}: borrarlo rompería la
            trazabilidad de las respuestas que ya se dieron con él.{' '}
            {publicado ? 'Archívalo en su lugar' : 'Ya está archivado, que es el estado correcto'} (RN-13.5.4).
          </p>
          <div className="acciones" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onCerrar}>Entendido</button>
            {publicado && (
              <button className="btn btn-amber" onClick={onArchivarEnSuLugar}>Archivar en su lugar</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Eliminar borrador · {articulo.titulo}</h3>
        <p className="small">
          Este borrador <b>nunca se publicó</b>, así que no sustenta ninguna respuesta del bot y
          puede eliminarse definitivamente. La acción no se puede deshacer.
        </p>
        <div className="acciones" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-danger" onClick={onConfirmar}>Eliminar definitivamente</button>
        </div>
      </div>
    </div>
  );
}
