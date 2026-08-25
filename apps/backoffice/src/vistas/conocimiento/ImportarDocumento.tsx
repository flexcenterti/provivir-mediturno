import { useEffect, useRef, useState } from 'react';
import { api, refrescarSesion, token, type ImportacionKb } from '../../api';

/**
 * Importación de un documento del cliente (P6, P13) a artículos.
 *
 * Sube el archivo tal cual y el servidor lo trocea por encabezados. **Todo entra
 * como borrador**: lo que acaba de subir alguien no lo ha revisado nadie, y al bot
 * solo se le sirve lo aprobado (RN-13.7.1).
 */
export function ImportarDocumento({ hayPublicados, onCambio }: {
  hayPublicados: boolean;
  onCambio: () => void;
}) {
  const [importaciones, setImportaciones] = useState<ImportacionKb[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const entrada = useRef<HTMLInputElement>(null);

  const recargar = () => { void api.importacionesKb().then(setImportaciones).catch(() => undefined); };

  useEffect(() => {
    recargar();
    // El troceo tarda: se refresca solo mientras la pestaña está abierta.
    const id = setInterval(recargar, 4_000);
    return () => clearInterval(id);
  }, []);

  async function subir(archivo: File) {
    setSubiendo(true); setError(''); setAviso('');
    try {
      const form = new FormData();
      form.append('archivo', archivo);
      // FormData no pasa por `pedir` —fija Content-Type JSON—, así que la
      // renovación silenciosa se pide a mano: subir el documento justo cuando
      // vence el token no puede costar el archivo.
      const enviar = async () =>
        fetch('/api/conocimiento/importar/documento', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token.leer()}` },
          body: form,
        });

      let r = await enviar();
      if (r.status === 401 && (await refrescarSesion())) r = await enviar();

      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.message ?? 'No fue posible importar el documento');
      }
      const cuerpo = await r.json();
      setAviso(cuerpo.mensaje ?? 'Importación encolada.');
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="card plano" style={{ marginBottom: '1rem' }}>
      <div className="hd">
        <h3>Importar documento</h3>
        <div className="spacer" />
        <span className="tag t-blue">P6 · P13</span>
      </div>

      <div className="bd">
        {error && <div className="error" role="alert">{error}</div>}
        {aviso && <div className="exito">{aviso}</div>}

        <p className="nota" style={{ marginBottom: '.7rem' }}>
          Sube el documento del cliente en <code>.md</code> o <code>.txt</code>. El sistema lo parte
          por encabezados: un artículo por sección, con el servicio del catálogo vinculado cuando el
          título lo identifica sin ambigüedad.
        </p>

        <div className="acciones" style={{ marginTop: 0 }}>
          <input ref={entrada} type="file" accept=".md,.txt" hidden
                 onChange={(e) => {
                   const archivo = e.target.files?.[0];
                   // Se limpia para poder volver a elegir el mismo archivo.
                   e.target.value = '';
                   if (archivo) void subir(archivo);
                 }} />
          <button className="btn btn-soft" disabled={subiendo} onClick={() => entrada.current?.click()}>
            {subiendo ? 'Subiendo…' : '📤 Elegir documento'}
          </button>

          {/* Migración del bloque que el bot ya venía usando desde el prompt: por
              eso esta sí publica. Solo tiene sentido con la base vacía. */}
          {!hayPublicados && (
            <button className="btn btn-ghost btn-sm" onClick={() => {
              void api.importarConocimiento()
                .then((r) => {
                  setAviso(
                    `${r.creados.length} artículo(s) importados de la documentación comercial.` +
                    (r.sinServicio.length
                      ? ` ${r.sinServicio.length} quedaron sin servicio vinculado y conviene atarlos a mano: ${r.sinServicio.join(', ')}.`
                      : ''),
                  );
                  onCambio();
                })
                .catch((e: Error) => setError(e.message));
            }}>
              Importar documentación comercial de Reglas
            </button>
          )}
        </div>

        <p className="aviso" style={{ marginTop: '.8rem' }}>
          Los artículos entran como <b>borrador</b>: nada llega al bot hasta que alguien los revise
          y los publique (RN-13.7.1).
        </p>

        {importaciones.length > 0 && (
          <>
            <div className="rotulo">Importaciones recientes</div>
            <table className="tabla">
              <thead>
                <tr><th>Archivo</th><th>Estado</th><th>Resultado</th><th className="right" /></tr>
              </thead>
              <tbody>
                {importaciones.map((i) => (
                  <tr key={i.id}>
                    <td className="small"><b>{i.archivo}</b></td>
                    <td><EstadoImportacion estado={i.estado} progreso={i.progreso} /></td>
                    <td className="small">
                      {i.resumen ? (
                        <>
                          {i.resumen.creados} creados · {i.resumen.omitidos} ya existían ·{' '}
                          {i.resumen.erroneos} con error
                          {i.resumen.sinServicio.length > 0 && (
                            <div className="small muted">
                              Sin servicio vinculado: {i.resumen.sinServicio.join(', ')}
                            </div>
                          )}
                        </>
                      ) : <span className="muted">{i.error ?? '—'}</span>}
                    </td>
                    <td className="right">
                      {(i.resumen?.erroneos ?? 0) > 0 && (
                        <a className="btn btn-ghost btn-sm"
                           href={`/api/conocimiento/importaciones/${i.id}/errores.csv`}>
                          Ver errores
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

function EstadoImportacion({ estado, progreso }: {
  estado: string; progreso: ImportacionKb['progreso'];
}) {
  const avance = typeof progreso === 'object' && progreso !== null
    ? ` ${progreso.procesados}/${progreso.total}`
    : '';

  if (estado === 'completed') return <span className="tag t-green">Terminada</span>;
  if (estado === 'failed') return <span className="tag t-red">Falló</span>;
  if (estado === 'active') return <span className="tag t-amber">En curso{avance}</span>;
  return <span className="tag t-gray">En cola</span>;
}
