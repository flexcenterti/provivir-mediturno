import fc from 'fast-check';
import {
  dentroDeFranja, fechasDeVentana, parsearDias, parsearFranja, parsearVentana,
  serializarVentana, ventanaPara, VENTANA_BASE,
} from '../autoagendamiento';

const dia = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dias = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);

// Semana de referencia: 2026-09-07 es lunes.
const LUNES = dia('2026-09-07');
const HOY_POR_DIA = [1, 2, 3, 4, 5, 6, 7].map((d) => dia(`2026-09-${String(6 + d).padStart(2, '0')}`));

describe('ventanaPara', () => {
  /*
   * Mata: cualquier desfase de un día en la aritmética. Los siete `+N` los anotó el
   * cliente a mano en su tabla, así que esta prueba es literalmente el acuerdo escrito.
   */
  it('las siete filas del cliente dan exactamente los +N que él anotó', () => {
    const esperados = [2, 2, 5, 4, 4, 3, 3];
    HOY_POR_DIA.forEach((hoy, i) => {
      const v = ventanaPara(hoy, [...VENTANA_BASE], false);
      expect({ dia: i + 1, mas: dias(hoy, v.inicio) }).toEqual({ dia: i + 1, mas: esperados[i] });
    });
  });

  /* Y los finales, que el cliente no escribió pero se derivan y conviene fijar. */
  it('los finales de ventana son los que se derivan de la tabla', () => {
    const esperados = [4, 3, 9, 8, 7, 6, 5];
    HOY_POR_DIA.forEach((hoy, i) => {
      const v = ventanaPara(hoy, [...VENTANA_BASE], false);
      expect({ dia: i + 1, mas: dias(hoy, v.fin) }).toEqual({ dia: i + 1, mas: esperados[i] });
    });
  });

  /*
   * Mata: `>=` en vez de `>` al buscar el «desde». Un miércoles que puede reservar «desde
   * el miércoles» tiene que ofrecer el de la semana que viene, no hoy mismo — si no, toda
   * la tabla se corre un día y el paciente agenda para el mismo día.
   */
  it('el inicio es estrictamente posterior a hoy, aunque el día coincida', () => {
    const miercoles = dia('2026-09-09');
    const v = ventanaPara(miercoles, [{ dia: 3, desde: 3, hasta: 3 }], false);
    expect(dias(miercoles, v.inicio)).toBe(7);
  });

  /*
   * Mata: calcular el fin también como «estrictamente posterior», que mandaría una
   * ventana de un solo día a la semana siguiente.
   */
  it('desde y hasta iguales dan una ventana de un solo día', () => {
    const v = ventanaPara(LUNES, [{ dia: 1, desde: 3, hasta: 3 }], false);
    expect(dias(v.inicio, v.fin)).toBe(0);
  });

  /* Mata: cualquier supuesto de «misma semana». La ventana envuelve sin caso especial. */
  it('si el hasta cae antes que el desde, la ventana cruza el fin de semana', () => {
    const v = ventanaPara(LUNES, [{ dia: 1, desde: 5, hasta: 2 }], false);
    expect(dias(LUNES, v.inicio)).toBe(4); // viernes
    expect(dias(v.inicio, v.fin)).toBe(4); // hasta el martes
  });

  /*
   * Mata: ignorar la bandera de festivo. «Domingo o festivos» comparten fila, y un viernes
   * festivo tiene que dar la ventana del domingo (+5) y no la del viernes (+4).
   *
   * El ejemplo es un VIERNES a propósito: para un lunes las dos filas de la tabla del
   * cliente coinciden, así que un lunes festivo no probaría nada de la bandera.
   */
  it('un festivo usa la fila del domingo cuando esta es más restrictiva', () => {
    const viernes = dia('2026-09-11');
    expect(dias(viernes, ventanaPara(viernes, [...VENTANA_BASE], false).inicio)).toBe(4);
    expect(dias(viernes, ventanaPara(viernes, [...VENTANA_BASE], true).inicio)).toBe(5);
  });

  /*
   * Mata: aplicar la fila del domingo a secas. Un 1 de enero en martes daría +1 —la fila
   * del domingo empieza en miércoles— frente a los +2 del martes normal: un día cerrado
   * abriría MÁS margen que uno abierto, que es al revés de lo que la regla quiere.
   */
  it('un festivo nunca abre la ventana antes que el día normal', () => {
    const martes = dia('2026-09-08');
    expect(dias(martes, ventanaPara(martes, [...VENTANA_BASE], false).inicio)).toBe(2);
    expect(dias(martes, ventanaPara(martes, [...VENTANA_BASE], true).inicio)).toBe(2);
  });

  /* Mata: un desfase de 7 en el módulo. El ancho está acotado por construcción. */
  it('la ventana nunca es más ancha que seis días, sea cual sea la tabla', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 7 }), fc.integer({ min: 1, max: 7 }), fc.integer({ min: 0, max: 6 }),
      (desde, hasta, offset) => {
        const hoy = new Date(LUNES.getTime() + offset * 86_400_000);
        const v = ventanaPara(hoy, [{ dia: 1, desde, hasta }, ...VENTANA_BASE.slice(1)], false);
        const ancho = dias(v.inicio, v.fin);
        return ancho >= 0 && ancho <= 6;
      },
    ));
  });

  /*
   * Mata: permitir que el inicio caiga en hoy o antes. Es la propiedad que permite
   * AFIRMAR que la ventana nunca ofrece el día en curso, en vez de suponerlo de la tabla.
   */
  it('el inicio siempre es posterior a hoy', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 7 }), fc.integer({ min: 0, max: 30 }), fc.boolean(),
      (desde, offset, festivo) => {
        const hoy = new Date(LUNES.getTime() + offset * 86_400_000);
        const filas = VENTANA_BASE.map((f) => ({ ...f, desde }));
        return ventanaPara(hoy, filas, festivo).inicio.getTime() > hoy.getTime();
      },
    ));
  });
});

describe('fechasDeVentana', () => {
  /*
   * Mata: excluir recortando el rango en vez de restar de la lista. Un día excluido en
   * MEDIO de la ventana se colaría, y los bordes se moverían sin motivo.
   */
  it('los días excluidos se restan de en medio, sin mover los bordes', () => {
    const v = { inicio: LUNES, fin: dia('2026-09-11') }; // lunes a viernes
    const fechas = fechasDeVentana(v, [3], new Set()); // sin miércoles
    expect(fechas).toEqual(['2026-09-07', '2026-09-08', '2026-09-10', '2026-09-11']);
  });

  /*
   * Mata: publicar los días cerrados. El rechazo sigue siendo de `validarDiaLaborable`,
   * que dice el motivo; lo que no puede pasar es que el bot ofrezca el 25 de diciembre
   * con confianza y queme un turno.
   */
  it('los días cerrados no se anuncian', () => {
    const v = { inicio: LUNES, fin: dia('2026-09-09') };
    expect(fechasDeVentana(v, [], new Set(['2026-09-08']))).toEqual(['2026-09-07', '2026-09-09']);
  });

  /* Mata: devolver un rango invertido en vez de una lista vacía que el portal sepa leer. */
  it('una ventana entera excluida devuelve una lista vacía, no un rango raro', () => {
    const v = { inicio: dia('2026-09-12'), fin: dia('2026-09-13') }; // sábado y domingo
    expect(fechasDeVentana(v, [6, 7], new Set())).toEqual([]);
  });
});

describe('los parsers, que leen lo que alguien tecleó en Administración', () => {
  /* Mata: no cerrar el ciclo — lo que se guarda tiene que volver a leerse igual. */
  it('lo serializado se vuelve a leer igual', () => {
    expect(parsearVentana(serializarVentana(VENTANA_BASE))).toEqual([...VENTANA_BASE]);
    expect(serializarVentana(VENTANA_BASE)).toBe('1:3-5,2:4-5,3:1-5,4:1-5,5:2-5,6:2-5,7:3-5');
  });

  /*
   * Mata: `catch { return [] }`. Una lista vacía no significa «sin regla», significa que
   * cualquier fecha vale — o sea, abrir el canal de par en par por un dedazo en una
   * casilla de texto. El respaldo tiene que ir hacia la restricción.
   */
  it('cualquier cosa ilegible cae a la tabla base, nunca a «todo vale»', () => {
    for (const malo of ['', '   ', 'basura', '1:9-5', '1:3-5,2:4-5', '1:3-5,1:4-5', '8:1-2']) {
      expect(parsearVentana(malo)).toEqual([...VENTANA_BASE]);
    }
  });

  /*
   * Mata: llamar a `aMinutos`, que LANZA con una hora inválida. Esto se lee dentro de una
   * consulta de cupos del portal público: un valor mal tecleado se convertiría en un 500
   * para el paciente.
   */
  it('una franja ilegible cae a la base y no revienta', () => {
    const base = { desde: 0, hasta: 1439 };
    for (const malo of ['', '25:00-26:00', '12:00', 'tarde', '18:00-09:00', '12:60-13:00']) {
      expect(parsearFranja(malo, base)).toEqual(base);
    }
    expect(parsearFranja('12:00-18:00', base)).toEqual({ desde: 720, hasta: 1080 });
  });

  /* Mata: tratar la cadena vacía como «usa la base» — es «no excluyas ningún día». */
  it('una lista de días vacía significa ninguno, no la base', () => {
    expect(parsearDias('', [6, 7])).toEqual([]);
    expect(parsearDias(undefined, [6, 7])).toEqual([6, 7]);
    expect(parsearDias('6,7', [])).toEqual([6, 7]);
    expect(parsearDias('9', [6])).toEqual([6]);
  });
});

describe('dentroDeFranja', () => {
  /*
   * Mata: `<=` en el cierre. A las 18:00 en punto el canal tiene que estar cerrado, o el
   * horario anunciado y el real difieren en un minuto justo en el borde.
   */
  it('incluye el minuto de apertura y excluye el de cierre', () => {
    const f = { desde: 720, hasta: 1080 }; // 12:00–18:00
    expect(dentroDeFranja(720, f)).toBe(true);
    expect(dentroDeFranja(1079, f)).toBe(true);
    expect(dentroDeFranja(1080, f)).toBe(false);
    expect(dentroDeFranja(719, f)).toBe(false);
  });
});
