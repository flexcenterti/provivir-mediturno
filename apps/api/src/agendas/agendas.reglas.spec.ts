import { diaSemanaIso, franjaAplicaA, franjasSeSolapan, type Franja } from './agendas.reglas';

const semanal = (dias: number[], horaIni: string, horaFin: string, slotMin = 15): Franja =>
  ({ modo: 'semanal', diasSemana: dias, fecha: null, horaIni, horaFin, slotMin });
const calendario = (iso: string, horaIni: string, horaFin: string, slotMin = 15): Franja =>
  ({ modo: 'calendario', diasSemana: [], fecha: new Date(`${iso}T00:00:00Z`), horaIni, horaFin, slotMin });

describe('franjaAplicaA', () => {
  // 2026-09-10 es jueves.
  const jueves = new Date('2026-09-10T00:00:00Z');

  /* Mata: invertir la comprobación de día — la agenda regiría los días equivocados. */
  it('la semanal rige los días que declara y ningún otro', () => {
    expect(franjaAplicaA(jueves, semanal([1, 2, 3, 4, 5], '07:00', '12:00'))).toBe(true);
    expect(franjaAplicaA(jueves, semanal([6], '07:00', '12:00'))).toBe(false);
  });

  /* Mata: comparar fechas con `===` sobre los objetos Date, que nunca son iguales. */
  it('la de calendario rige solo su fecha exacta', () => {
    expect(franjaAplicaA(jueves, calendario('2026-09-10', '07:00', '12:00'))).toBe(true);
    expect(franjaAplicaA(jueves, calendario('2026-09-11', '07:00', '12:00'))).toBe(false);
  });

  /* Mata: usar `getDay()` sin corregir el domingo, que en ISO es 7 y no 0. */
  it('el domingo es 7, no 0', () => {
    expect(diaSemanaIso(new Date('2026-09-13T00:00:00Z'))).toBe(7);
    expect(diaSemanaIso(new Date('2026-09-07T00:00:00Z'))).toBe(1);
  });
});

describe('franjasSeSolapan', () => {
  /*
   * Mata: usar `<=` en el cruce de rangos. La jornada partida del catálogo real es
   * 07:00–12:00 y 12:30–16:30; con `<=` una que cierra donde abre la otra se daría por
   * solapada y el horario real de la clínica dejaría de poder guardarse.
   */
  it('dos franjas que se tocan no se solapan', () => {
    expect(franjasSeSolapan(semanal([1], '07:00', '12:00'), semanal([1], '12:00', '16:00'))).toBe(false);
    expect(franjasSeSolapan(semanal([1], '07:00', '12:00'), semanal([1], '11:59', '16:00'))).toBe(true);
  });

  /*
   * Mata: ignorar los días y comparar solo las horas. «Lun 07–12» y «Sáb 07–12» son la
   * configuración normal de medio catálogo y se rechazarían.
   */
  it('sin día en común no hay solape, por mucho que las horas coincidan', () => {
    expect(franjasSeSolapan(semanal([1, 2, 3, 4, 5], '07:00', '12:00'), semanal([6], '07:00', '12:00'))).toBe(false);
    expect(franjasSeSolapan(semanal([1, 2], '07:00', '12:00'), semanal([2, 3], '11:00', '16:00'))).toBe(true);
  });

  /*
   * Mata: comparar solo modos iguales. El cruce semanal × calendario es real —un
   * especialista con fecha puntual un jueves sobre una agenda de lunes a viernes— y se
   * colaría entero.
   */
  it('una fecha puntual choca con la semanal que rige ese día', () => {
    // 2026-09-10 es jueves.
    expect(franjasSeSolapan(semanal([1, 2, 3, 4, 5], '07:00', '12:00'), calendario('2026-09-10', '08:00', '10:00'))).toBe(true);
    // 2026-09-12 es sábado, que no está en la semanal.
    expect(franjasSeSolapan(semanal([1, 2, 3, 4, 5], '07:00', '12:00'), calendario('2026-09-12', '08:00', '10:00'))).toBe(false);
  });

  /* Mata: no cubrir el orden inverso de los argumentos en el cruce de modos. */
  it('el cruce de modos da igual en qué orden se pase', () => {
    const s = semanal([4], '07:00', '12:00');
    const c = calendario('2026-09-10', '08:00', '10:00');
    expect(franjasSeSolapan(c, s)).toBe(franjasSeSolapan(s, c));
    expect(franjasSeSolapan(c, s)).toBe(true);
  });

  /* Mata: dar por solapadas dos fechas puntuales distintas. */
  it('dos fechas puntuales distintas no se solapan', () => {
    expect(franjasSeSolapan(calendario('2026-09-10', '08:00', '12:00'), calendario('2026-09-11', '08:00', '12:00'))).toBe(false);
    expect(franjasSeSolapan(calendario('2026-09-10', '08:00', '12:00'), calendario('2026-09-10', '11:00', '13:00'))).toBe(true);
  });
});
