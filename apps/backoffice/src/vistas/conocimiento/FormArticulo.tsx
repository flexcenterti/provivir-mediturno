import { useEffect, useState } from 'react';
import { api, type ArticuloDetalle, type Servicio } from '../../api';

/**
 * Alta y edición de un artículo.
 *
 * Faltaba entera: los endpoints existían desde la fase 7 y no había forma de
 * llamarlos, así que la base solo se podía poblar con el importador automático.
 *
 * Al editar se muestra debajo el troceado real, que es lo que se indexa. Sirve
 * para entender por qué una pregunta no recupera un artículo: si el dato quedó
 * partido entre dos fragmentos, ninguno alcanza el umbral solo.
 */
export function FormArticulo({ articuloId, servicios, categorias, onCerrar, onGuardado }: {
  /** `null` para crear. */
  articuloId: string | null;
  servicios: Servicio[];
  categorias: string[];
  onCerrar: () => void;
  onGuardado: (mensaje: string) => void;
}) {
  const esNuevo = articuloId === null;

  const [detalle, setDetalle] = useState<ArticuloDetalle | null>(null);
  const [f, setF] = useState({
    titulo: '', categoria: '', servicioId: '', contenidoMd: '', tags: '', vigenteHasta: '',
  });
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(!esNuevo);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!articuloId) return;
    api.articulo(articuloId)
      .then((a) => {
        setDetalle(a);
        setF({
          titulo: a.titulo,
          categoria: a.categoria,
          servicioId: a.servicioId ?? '',
          contenidoMd: a.contenidoMd,
          tags: (a.tags ?? []).join(', '),
          vigenteHasta: a.vigenteHasta ? a.vigenteHasta.slice(0, 10) : '',
        });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false));
  }, [articuloId]);

  const listo = f.titulo.trim().length >= 3 && f.categoria.trim().length >= 2 && f.contenidoMd.trim() !== '';

  async function guardar() {
    setError(''); setGuardando(true);
    const cuerpo = {
      titulo: f.titulo.trim(),
      categoria: f.categoria.trim(),
      contenidoMd: f.contenidoMd,
      tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      // `null` explícito para poder desvincular y limpiar; omitirlo significaría
      // «no lo toques», que no es lo que quiere quien acaba de vaciar el campo.
      servicioId: f.servicioId || null,
      vigenteHasta: f.vigenteHasta || null,
    };
    try {
      if (esNuevo) {
        await api.crearArticulo(cuerpo);
        onGuardado(`«${cuerpo.titulo}» creado como borrador. Publícalo para que el bot lo use.`);
      } else {
        await api.actualizarArticulo(articuloId, cuerpo);
        onGuardado(
          detalle?.estado === 'publicado'
            ? `«${cuerpo.titulo}» actualizado y reindexado: el bot ya usa la versión nueva.`
            : `«${cuerpo.titulo}» actualizado.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal ancho" onClick={(e) => e.stopPropagation()}>
        <h3>{esNuevo ? 'Nuevo artículo' : f.titulo || 'Artículo'}</h3>
        {error && <div className="error" role="alert">{error}</div>}

        {cargando ? <p className="nota">Cargando…</p> : (
          <>
            <div className="field">
              <label htmlFor="art-titulo">Título</label>
              <input id="art-titulo" value={f.titulo} maxLength={160}
                     placeholder="Cómo lo buscaría alguien que trabaja aquí"
                     onChange={(e) => setF({ ...f, titulo: e.target.value })} />
            </div>

            <div className="grid-2">
              <div className="field">
                <label htmlFor="art-cat">Categoría</label>
                <input id="art-cat" value={f.categoria} list="art-categorias" maxLength={60}
                       placeholder="Preparación, Servicios, Políticas…"
                       onChange={(e) => setF({ ...f, categoria: e.target.value })} />
                <datalist id="art-categorias">
                  {categorias.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>

              <div className="field">
                <label htmlFor="art-serv">Servicio vinculado</label>
                <select id="art-serv" value={f.servicioId}
                        onChange={(e) => setF({ ...f, servicioId: e.target.value })}>
                  <option value="">— General</option>
                  {servicios.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
                <span className="p-ayuda">
                  Vincularlo hace que las cifras del ofrecimiento salgan de su ficha (RN-13.1).
                </span>
              </div>
            </div>

            <div className="field">
              <label htmlFor="art-md">Contenido</label>
              <textarea id="art-md" rows={14} value={f.contenidoMd} maxLength={60_000}
                        placeholder={'## Título de la sección\n\nEl texto que sustenta la respuesta.'}
                        onChange={(e) => setF({ ...f, contenidoMd: e.target.value })} />
              <span className="p-ayuda">
                Markdown. Se trocea por encabezados al publicar · {f.contenidoMd.length.toLocaleString('es-CO')} de 60.000 caracteres.
              </span>
            </div>

            <div className="grid-2">
              <div className="field">
                <label htmlFor="art-tags">Etiquetas</label>
                <input id="art-tags" value={f.tags} placeholder="ecografía, ayuno, preparación"
                       onChange={(e) => setF({ ...f, tags: e.target.value })} />
                <span className="p-ayuda">Separadas por coma.</span>
              </div>

              <div className="field">
                <label htmlFor="art-vig">Vigente hasta</label>
                <input id="art-vig" type="date" value={f.vigenteHasta}
                       onChange={(e) => setF({ ...f, vigenteHasta: e.target.value })} />
                <span className="p-ayuda">
                  Opcional. Cumplida la fecha el artículo se archiva solo (RN-13.5.5).
                </span>
              </div>
            </div>

            {detalle && detalle.fragmentos.length > 0 && (
              <>
                <div className="rotulo">Así queda troceado en el índice</div>
                {detalle.fragmentos.map((fr) => (
                  <div key={fr.id} className="kb-row">
                    <span className="small">
                      <b>#{fr.orden + 1}</b> {fr.texto.replace(/\s+/g, ' ').slice(0, 120)}…
                    </span>
                    <span className="small muted">{fr.tokens} palabras</span>
                  </div>
                ))}
                <p className="nota">
                  Es lo que se compara con la pregunta del paciente. Un dato partido entre dos
                  fragmentos hace que ninguno alcance el umbral por sí solo.
                </p>
              </>
            )}

            <div className="acciones">
              <button className="btn btn-primary" onClick={guardar} disabled={!listo || guardando}>
                {guardando ? 'Guardando…' : esNuevo ? 'Crear borrador' : 'Guardar'}
              </button>
              <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
