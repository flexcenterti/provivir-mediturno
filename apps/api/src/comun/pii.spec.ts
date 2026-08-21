import { enmascararDocumento, enmascararNombre, enmascararTelefono } from './pii';

/** Checklist §4.6 · logs sin PII en claro. */
describe('Enmascarado de PII para logs', () => {
  it('deja solo los últimos 4 dígitos del documento', () => {
    expect(enmascararDocumento('1234567890')).toBe('******7890');
  });

  it('enmascara documentos cortos por completo', () => {
    expect(enmascararDocumento('123')).toBe('***');
  });

  it('enmascara el teléfono conservando los últimos 4', () => {
    expect(enmascararTelefono('+57 300 111 1111')).toBe('***1111');
  });

  it('no revienta con valores ausentes', () => {
    expect(enmascararDocumento(null)).toBe('—');
    expect(enmascararTelefono(undefined)).toBe('—');
  });

  it('abrevia el nombre para trazas', () => {
    expect(enmascararNombre('Carlos', 'Mora')).toBe('Mora, C.');
  });
});

describe('identidades de WhatsApp sin teléfono', () => {
  it('no las disfraza de número', () => {
    // "US.13491208655302741918" termina en dígitos: sin la marca saldría como
    // ***1918 y en soporte se buscaría un teléfono que no existe.
    expect(enmascararTelefono('wa:US.13491208655302741918')).toBe('wa:***1918');
    expect(enmascararTelefono('wa:carlos.rivas')).toBe('wa:***ivas');
    expect(enmascararTelefono('wa:ana')).toBe('wa:***');
  });

  it('el teléfono se sigue enmascarando igual', () => {
    expect(enmascararTelefono('+573004765496')).toBe('***5496');
  });
});
