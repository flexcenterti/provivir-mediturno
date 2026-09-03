import { domingoDePascua, festivosColombia } from '../festivos';

/**
 * RN-06.5 · Los festivos se calculan, no se listan: doce de los dieciocho son
 * móviles. Estas pruebas los fijan contra años reales, porque un error aquí no
 * se nota hasta que un paciente agenda un día que la clínica tiene cerrado.
 */
describe('RN-06.5 · festivos de Colombia', () => {
  const fechas = (anio: number) => festivosColombia(anio).map((f) => f.fecha);
  const buscar = (anio: number, motivo: string) =>
    festivosColombia(anio).find((f) => f.motivo.includes(motivo))?.fecha;

  it('RN-06.5: son dieciocho al año', () => {
    for (const anio of [2026, 2027, 2028]) {
      expect(festivosColombia(anio)).toHaveLength(18);
    }
  });

  it('RN-06.5: dos festivos que caen el mismo día son UN día cerrado', () => {
    // 2025 · San Pedro (domingo 29 de junio) y el Sagrado Corazón (viernes 27) se
    // corren los dos al lunes 30. Ese año tiene 17 días festivos, no 18.
    const f2025 = festivosColombia(2025);
    expect(f2025).toHaveLength(17);
    const treinta = f2025.filter((x) => x.fecha === '2025-06-30');
    expect(treinta).toHaveLength(1);
    expect(treinta[0]!.motivo).toBe('San Pedro y San Pablo · Sagrado Corazón de Jesús');
  });

  it('RN-06.5: calcula el domingo de Pascua', () => {
    expect(domingoDePascua(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(domingoDePascua(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
    expect(domingoDePascua(2024).toISOString().slice(0, 10)).toBe('2024-03-31');
  });

  it('RN-06.5: el calendario de 2026 coincide con el oficial', () => {
    expect(fechas(2026)).toEqual([
      '2026-01-01', // Año Nuevo
      '2026-01-12', // Reyes, corrido del martes 6
      '2026-03-23', // San José, corrido del jueves 19
      '2026-04-02', // Jueves Santo
      '2026-04-03', // Viernes Santo
      '2026-05-01', // Día del Trabajo
      '2026-05-18', // Ascensión
      '2026-06-08', // Corpus Christi
      '2026-06-15', // Sagrado Corazón
      '2026-06-29', // San Pedro, que ya cae lunes
      '2026-07-20', // Independencia
      '2026-08-07', // Boyacá
      '2026-08-17', // Asunción, corrida del sábado 15
      '2026-10-12', // Día de la Raza, que ya cae lunes
      '2026-11-02', // Todos los Santos, corrido del domingo 1
      '2026-11-16', // Independencia de Cartagena, corrida del miércoles 11
      '2026-12-08', // Inmaculada
      '2026-12-25', // Navidad
    ]);
  });

  it('RN-06.5: la Ley Emiliani corre al lunes, y solo a los siete que le tocan', () => {
    // 2027: Reyes cae miércoles 6 → lunes 11.
    expect(buscar(2027, 'Reyes Magos')).toBe('2027-01-11');
    // Un festivo que ya cae lunes se queda: 1 de noviembre de 2027 es lunes.
    expect(buscar(2027, 'Todos los Santos')).toBe('2027-11-01');
    // Navidad no se traslada nunca, aunque caiga sábado (2027).
    expect(buscar(2027, 'Navidad')).toBe('2027-12-25');
  });

  it('RN-06.5: Jueves y Viernes Santo NO se trasladan', () => {
    // Siempre caen en jueves y viernes de Semana Santa, nunca en lunes.
    const pascua2027 = domingoDePascua(2027);
    const jueves = new Date(pascua2027.getTime() - 3 * 86_400_000);
    expect(buscar(2027, 'Jueves Santo')).toBe(jueves.toISOString().slice(0, 10));
    expect(buscar(2027, 'Jueves Santo')).toBe('2027-03-25');
    expect(buscar(2027, 'Viernes Santo')).toBe('2027-03-26');
  });

  it('RN-06.5: los derivados de la Pascua que sí se trasladan caen en lunes', () => {
    for (const anio of [2025, 2026, 2027, 2028]) {
      for (const motivo of ['Ascensión del Señor', 'Corpus Christi', 'Sagrado Corazón de Jesús']) {
        const f = buscar(anio, motivo)!;
        expect(new Date(`${f}T00:00:00Z`).getUTCDay()).toBe(1);
      }
    }
  });

  it('RN-06.5: no se repite ninguna fecha', () => {
    for (const anio of [2025, 2026, 2027, 2028, 2029, 2030]) {
      const f = fechas(anio);
      expect(new Set(f).size).toBe(f.length);
    }
  });

  it('RN-06.5: todas las fechas caen dentro del año pedido', () => {
    for (const f of fechas(2026)) expect(f.startsWith('2026-')).toBe(true);
  });
});
