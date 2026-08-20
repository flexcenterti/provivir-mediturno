import {
  columnasFaltantes, dentroDelUltimoAnio, mapearEncabezados, normalizarDocumento,
  normalizarFila, normalizarTelefono, parsearFecha,
} from './carga.normalizador';

describe('RN-12.2 · mapeo del archivo del cliente', () => {
  it('RN-12.2: mapea encabezados sin exigir formato exacto', () => {
    const mapa = mapearEncabezados(['Nombres', 'Apellidos', 'Número de Identificación', 'Número de contacto']);
    expect(mapa.nombres).toBe(0);
    expect(mapa.apellidos).toBe(1);
    expect(mapa.documento).toBe(2);
    expect(mapa.telefono).toBe(3);
  });

  it('RN-12.2: tolera tildes y mayúsculas en los encabezados', () => {
    const conTildes = mapearEncabezados(['NOMBRES', 'APELLIDOS', 'CÉDULA', 'TELÉFONO']);
    const sinTildes = mapearEncabezados(['nombres', 'apellidos', 'cedula', 'telefono']);
    expect(conTildes).toEqual(sinTildes);
  });

  it('RN-12.2: detecta las columnas obligatorias ausentes', () => {
    const mapa = mapearEncabezados(['Nombres', 'Teléfono']);
    expect(columnasFaltantes(mapa).sort()).toEqual(['apellidos', 'documento']);
  });

  it('acepta un archivo con las tres obligatorias aunque falte el resto', () => {
    const mapa = mapearEncabezados(['documento', 'nombres', 'apellidos']);
    expect(columnasFaltantes(mapa)).toEqual([]);
  });
});

describe('Normalización de campos', () => {
  it('limpia el teléfono dejando dígitos y prefijo', () => {
    expect(normalizarTelefono('+57 300 111-1111')).toBe('+573001111111');
    expect(normalizarTelefono('(2) 555 44 33')).toBe('25554433');
  });

  it('descarta teléfonos demasiado cortos para ser reales', () => {
    expect(normalizarTelefono('123')).toBeUndefined();
    expect(normalizarTelefono('')).toBeUndefined();
  });

  it('limpia el documento', () => {
    expect(normalizarDocumento('12.345.678')).toBe('12345678');
    expect(normalizarDocumento('  1234  ')).toBe('1234');
  });

  it('descarta documentos inválidos', () => {
    expect(normalizarDocumento('12')).toBeUndefined();
    expect(normalizarDocumento(undefined)).toBeUndefined();
  });

  it('parsea las tres formas de fecha del archivo del cliente', () => {
    expect(parsearFecha('2026-08-12')?.toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(parsearFecha('12/08/2026')?.toISOString()).toBe('2026-08-12T00:00:00.000Z');
    expect(parsearFecha('5-3-2026')?.toISOString()).toBe('2026-03-05T00:00:00.000Z');
    expect(parsearFecha('no es fecha')).toBeUndefined();
  });
});

describe('RN-12.3 · filtro de servicio en el último año', () => {
  const referencia = new Date('2026-08-20T00:00:00Z');

  it('RN-12.3: incluye a quien tuvo un servicio dentro del último año', () => {
    expect(dentroDelUltimoAnio(new Date('2026-03-01T00:00:00Z'), referencia)).toBe(true);
  });

  it('RN-12.3: excluye a quien no tiene servicios en el último año', () => {
    expect(dentroDelUltimoAnio(new Date('2024-01-15T00:00:00Z'), referencia)).toBe(false);
  });

  it('RN-12.3: el límite exacto de un año entra', () => {
    expect(dentroDelUltimoAnio(new Date('2025-08-20T00:00:00Z'), referencia)).toBe(true);
  });

  it('RN-12.3: un día antes del límite queda fuera', () => {
    expect(dentroDelUltimoAnio(new Date('2025-08-19T00:00:00Z'), referencia)).toBe(false);
  });

  it('RN-12.3: sin fecha de servicio no se puede afirmar el filtro → queda fuera', () => {
    expect(dentroDelUltimoAnio(undefined, referencia)).toBe(false);
  });
});

describe('Normalización de filas', () => {
  const mapa = mapearEncabezados(['documento', 'nombres', 'apellidos', 'telefono', 'servicio', 'fecha']);

  it('normaliza una fila completa', () => {
    const { fila } = normalizarFila(['12.345.678', 'Carlos', 'Mora', '+57 300 111 1111', 'Medicina general', '2026-07-30'], mapa);
    expect(fila).toMatchObject({
      documento: '12345678', nombres: 'Carlos', apellidos: 'Mora',
      telefono: '+573001111111', servicio: 'Medicina general',
    });
  });

  it('rechaza la fila sin documento válido', () => {
    const { fila, motivo } = normalizarFila(['', 'Carlos', 'Mora'], mapa);
    expect(fila).toBeUndefined();
    expect(motivo).toMatch(/Documento/);
  });

  it('rechaza la fila sin nombres o apellidos', () => {
    const { fila, motivo } = normalizarFila(['12345678', 'Carlos', ''], mapa);
    expect(fila).toBeUndefined();
    expect(motivo).toMatch(/Nombres o apellidos/);
  });

  it('descarta un correo sin arroba en vez de guardar basura', () => {
    const conCorreo = mapearEncabezados(['documento', 'nombres', 'apellidos', 'correo']);
    const { fila } = normalizarFila(['12345678', 'Carlos', 'Mora', 'no-es-correo'], conCorreo);
    expect(fila?.correo).toBeUndefined();
  });
});
