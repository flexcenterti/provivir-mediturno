import { useState } from 'react';
import { api, type Servicio } from '../api';

/**
 * Ficha comercial del servicio (RN-04.5.1).
 *
 * Vive aparte porque se edita desde dos sitios: el formulario completo del
 * catálogo y la tabla de Base de conocimiento, donde es lo primero que se revisa
 * cuando el bot dice algo raro de un servicio.
 *
 * **Las cifras del bot salen de aquí, no del texto de los artículos** (RN-13.1):
 * la duración, los cupos y el precio los pone el catálogo, así que un artículo mal
 * redactado nunca hace que el bot invente un número.
 */

export interface CamposFicha {
  descripcionComercial: string;
  /** Una por línea en el formulario; el API los recibe como lista. */
  beneficios: string;
  preparacion: string;
  enlaceInfo: string;
  rangoPrecio: string;
  agendable: boolean;
}

export const fichaDesde = (s: Servicio | null): CamposFicha => ({
  descripcionComercial: s?.descripcionComercial ?? '',
  beneficios: (s?.beneficios ?? []).join('\n'),
  preparacion: s?.preparacion ?? '',
  enlaceInfo: s?.enlaceInfo ?? '',
  rangoPrecio: s?.rangoPrecio ?? '',
  agendable: s?.agendable ?? true,
});

export const fichaAPayload = (f: CamposFicha) => ({
  descripcionComercial: f.descripcionComercial.trim() || undefined,
  beneficios: f.beneficios.split('\n').map((b) => b.trim()).filter(Boolean),
  preparacion: f.preparacion.trim() || undefined,
  enlaceInfo: f.enlaceInfo.trim() || undefined,
  rangoPrecio: f.rangoPrecio.trim() || undefined,
  agendable: f.agendable,
});

/**
 * Misma condición que aplica el backend al decidir si el bot puede ofrecer el
 * servicio: sin descripción ni beneficios no sabe qué decir de él.
 */
export const tieneFicha = (s: Servicio): boolean =>
  Boolean(s.descripcionComercial && (s.beneficios?.length ?? 0) > 0);

/**
 * Los campos, sin envoltorio. `prefijo` desambigua los `id` de los `label`:
 * desde que la ficha se puede abrir en dos sitios, puede haber dos en pantalla.
 */
export function CamposFichaComercial({ valores, onCambiar, prefijo = 'sv' }: {
  valores: CamposFicha;
  onCambiar: (v: CamposFicha) => void;
  prefijo?: string;
}) {
  const set = <K extends keyof CamposFicha>(k: K, v: CamposFicha[K]) =>
    onCambiar({ ...valores, [k]: v });

  return (
    <fieldset className="ficha-comercial">
      <legend>Ficha comercial</legend>
      <p className="p-ayuda">
        Es lo que el bot dice de este servicio. Sin descripción ni beneficios no lo ofrece
        por WhatsApp ni por el portal: no puede venderlo si no sabe qué decir de él.
      </p>

      <div className="field">
        <label htmlFor={`${prefijo}-desc`}>Descripción</label>
        <textarea id={`${prefijo}-desc`} rows={2} value={valores.descripcionComercial}
                  placeholder="Qué es y para qué sirve, en palabras de paciente"
                  onChange={(e) => set('descripcionComercial', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor={`${prefijo}-benef`}>Beneficios · uno por línea</label>
        <textarea id={`${prefijo}-benef`} rows={3} value={valores.beneficios}
                  placeholder={'Resultado el mismo día\nNo requiere remisión externa'}
                  onChange={(e) => set('beneficios', e.target.value)} />
        <span className="p-ayuda">El seguimiento usa uno distinto en cada mensaje, para no repetirse.</span>
      </div>

      <div className="field">
        <label htmlFor={`${prefijo}-prep`}>Preparación</label>
        <textarea id={`${prefijo}-prep`} rows={2} value={valores.preparacion}
                  placeholder="Ayuno de 6 horas, ropa cómoda…"
                  onChange={(e) => set('preparacion', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor={`${prefijo}-precio`}>Rango de precio</label>
        <input id={`${prefijo}-precio`} value={valores.rangoPrecio}
               placeholder="Opcional · el bot lo cita tal cual"
               onChange={(e) => set('rangoPrecio', e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor={`${prefijo}-enlace`}>Enlace con más información</label>
        <input id={`${prefijo}-enlace`} value={valores.enlaceInfo} maxLength={300}
               placeholder="Opcional · el bot lo comparte cuando piden más detalle"
               onChange={(e) => set('enlaceInfo', e.target.value)} />
      </div>

      <label className="p-check">
        <input type="checkbox" checked={valores.agendable}
               onChange={(e) => set('agendable', e.target.checked)} />
        Agendable por WhatsApp y portal
      </label>
    </fieldset>
  );
}

/**
 * Editar solo la ficha, sin salir de donde se está.
 *
 * Manda únicamente los campos comerciales: duración y cupos no viajan, y así no
 * se reenvían sin querer los dos campos que **no** son retroactivos (RN-04.5.2).
 */
export function ModalFichaComercial({ servicio, onCerrar, onGuardado }: {
  servicio: Servicio;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const [valores, setValores] = useState<CamposFicha>(fichaDesde(servicio));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setError(''); setGuardando(true);
    try {
      await api.actualizarServicio(servicio.id, fichaAPayload(valores));
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{servicio.nombre}</h3>
        {error && <div className="error" role="alert">{error}</div>}

        <CamposFichaComercial valores={valores} onCambiar={setValores} prefijo="kb-ficha" />

        <p className="nota">
          Cambiar la ficha tiene efecto inmediato en lo que responde el bot y no toca ninguna
          agenda, por eso no necesita periodo de gracia (RN-04.5.2). La duración, los cupos y el
          alta o baja del servicio se editan en Catálogo.
        </p>

        <div className="acciones">
          <button className="btn btn-primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar ficha'}
          </button>
          <button className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
