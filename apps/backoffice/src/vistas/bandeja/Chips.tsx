import type { Vista } from './tipos';

/** Un chip de filtro. `.chip-sel` ya existe y es exactamente esto. */
function Chip({ activo, onClick, children, cuenta, punto }: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
  cuenta?: number;
  punto?: boolean;
}) {
  return (
    <button className={`chip-sel${activo ? ' activo' : ''}`} onClick={onClick} aria-pressed={activo}>
      {children}
      {/*
        * El contador va fuera del nombre accesible: si entrara, `getByRole('button',
        * {name:'Pendientes', exact:true})` dejaría de casar en cuanto cambiara la cifra.
        */}
      {cuenta !== undefined && cuenta > 0 && <span className="chip-num" aria-hidden="true">{cuenta}</span>}
      {punto && <span className="chip-punto" aria-hidden="true">•</span>}
    </button>
  );
}

/**
 * Buscador y filtros de la lista.
 *
 * Los chips excluyentes eligen QUÉ lista se ve; los dos de la derecha la modifican, y
 * por eso van tras un separador. Son `<button>` con `aria-pressed` y no `role="radio"`:
 * lo segundo sería más purista y rompería las pruebas sin ganar nada para quien usa
 * lector de pantalla, que ya oye el estado por `aria-pressed`.
 */
export function Chips({
  vista, onVista, q, onQ, soloMias, onSoloMias,
  desde, hasta, onDesde, onHasta, pendientes, interesados,
}: {
  vista: Vista;
  onVista: (v: Vista) => void;
  q: string;
  onQ: (v: string) => void;
  soloMias: boolean;
  onSoloMias: (v: boolean) => void;
  desde: string;
  hasta: string;
  onDesde: (v: string) => void;
  onHasta: (v: string) => void;
  pendientes: number;
  interesados: number;
}) {
  const conFechas = vista === 'cerradas' || vista === 'todas';
  const hayRango = Boolean(desde || hasta);

  return (
    <div className="bandeja-filtros">
      <div className="buscador">
        <input
          placeholder="Teléfono, nombre o documento…"
          value={q}
          onChange={(e) => onQ(e.target.value)}
        />
      </div>

      <div className="chips-filtro" role="group" aria-label="Filtros de la bandeja">
        <Chip activo={vista === 'pendientes'} onClick={() => onVista('pendientes')} cuenta={pendientes}>
          Pendientes
        </Chip>
        <Chip activo={vista === 'cerradas'} onClick={() => onVista('cerradas')}>Cerradas</Chip>
        <Chip activo={vista === 'todas'} onClick={() => onVista('todas')}>Todas</Chip>
        <Chip activo={vista === 'interesados'} onClick={() => onVista('interesados')} cuenta={interesados}>
          Interesados
        </Chip>

        <span className="sep" />

        <Chip activo={soloMias} onClick={() => onSoloMias(!soloMias)}>Solo las mías</Chip>
        {/*
          * Las fechas solo tienen sentido donde el backend filtra por ellas. En
          * pendientes no aporta —son decenas y caben en una página— y en interesados no
          * existe el filtro.
          */}
        {conFechas && (
          <Chip
            activo={hayRango}
            punto={hayRango}
            onClick={() => { if (hayRango) { onDesde(''); onHasta(''); } else { onDesde(hoy()); } }}
          >
            📅 Fechas
          </Chip>
        )}
      </div>

      {conFechas && hayRango && (
        <div className="rango-fechas">
          <label>Desde <input type="date" value={desde} onChange={(e) => onDesde(e.target.value)} /></label>
          <label>Hasta <input type="date" value={hasta} onChange={(e) => onHasta(e.target.value)} /></label>
        </div>
      )}
    </div>
  );
}

/** El día de hoy, para que abrir el rango no deje los dos campos vacíos y sin efecto. */
const hoy = () => new Date().toLocaleDateString('en-CA');
