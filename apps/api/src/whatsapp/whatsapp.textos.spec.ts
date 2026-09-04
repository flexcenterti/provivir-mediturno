import { avisoConsentimiento, BIENVENIDA, leerRespuestaConsentimiento } from './whatsapp.textos';

/**
 * RN-09.10 · La lectura de la respuesta decide si se trata o no a una persona sus datos
 * personales. Un falso positivo aquí es tratar datos sin autorización.
 */
describe('RN-09.10 · respuesta al consentimiento', () => {
  it('RN-09.10: el id del botón manda sobre el texto', () => {
    expect(leerRespuestaConsentimiento('consentimiento_acepto', 'lo que sea')).toBe('acepta');
    expect(leerRespuestaConsentimiento('consentimiento_rechazo', 'Acepto')).toBe('rechaza');
  });

  it('RN-09.10: «no acepto» NO se lee como aceptación', () => {
    // Contiene la palabra «acepto»: es el error que dejaría entrar a quien dijo que no.
    for (const t of ['No acepto', 'no acepto', 'NO ACEPTO', ' no acepto ']) {
      expect(leerRespuestaConsentimiento(undefined, t)).toBe('rechaza');
    }
  });

  it('RN-09.10: acepta el respaldo escrito, con y sin tildes', () => {
    for (const t of ['acepto', 'ACEPTO', 'Sí', 'si', 'autorizo', 'de acuerdo']) {
      expect(leerRespuestaConsentimiento(undefined, t)).toBe('acepta');
    }
  });

  it('RN-09.10: cualquier otra cosa no decide nada', () => {
    // Ante la duda no se asume autorización: se vuelve a preguntar.
    for (const t of ['quiero una cita', 'hola', '', undefined, 'aceptar la cita del martes']) {
      expect(leerRespuestaConsentimiento(undefined, t)).toBeNull();
    }
  });

  it('RN-09.10: el aviso cita la ley y enlaza la política vigente', () => {
    const texto = avisoConsentimiento('https://ejemplo/politica.pdf');
    expect(texto).toMatch(/ley 1581 de 2012/i);
    expect(texto).toContain('https://ejemplo/politica.pdf');
    // Meta admite 1024 caracteres en el cuerpo de un mensaje interactivo.
    expect(texto.length).toBeLessThan(1024);
  });

  it('RN-09.10: la bienvenida lleva la marca y la sede actuales', () => {
    expect(BIENVENIDA).toContain('Centro de Profesionales & Provivir');
    expect(BIENVENIDA).toContain('CPP Principal');
    expect(BIENVENIDA).not.toMatch(/Grupo Provivir|CDC Oriente/);
  });
});
