import { createHmac } from 'node:crypto';
import { firmaValida, respuestaDeVerificacion } from './firma';

const SECRETO = 'secreto-de-la-app-de-meta';
const cuerpo = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));
const firmar = (b: Buffer, s = SECRETO) => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`;

/** Checklist §4.7 · la firma del webhook se verifica siempre. Test dedicado. */
describe('Verificación de X-Hub-Signature-256', () => {
  it('acepta una firma válida', () => {
    expect(firmaValida(cuerpo, firmar(cuerpo), SECRETO)).toBe(true);
  });

  it('rechaza una firma calculada con otro secreto', () => {
    expect(firmaValida(cuerpo, firmar(cuerpo, 'otro-secreto'), SECRETO)).toBe(false);
  });

  it('rechaza si el cuerpo fue alterado', () => {
    const firma = firmar(cuerpo);
    const alterado = Buffer.from(JSON.stringify({ object: 'malicioso' }));
    expect(firmaValida(alterado, firma, SECRETO)).toBe(false);
  });

  it('rechaza sin cabecera', () => {
    expect(firmaValida(cuerpo, undefined, SECRETO)).toBe(false);
  });

  it('rechaza un algoritmo distinto de sha256', () => {
    const hex = createHmac('sha256', SECRETO).update(cuerpo).digest('hex');
    expect(firmaValida(cuerpo, `sha1=${hex}`, SECRETO)).toBe(false);
  });

  it('rechaza una cabecera con formato roto', () => {
    expect(firmaValida(cuerpo, 'sha256=', SECRETO)).toBe(false);
    expect(firmaValida(cuerpo, 'basura', SECRETO)).toBe(false);
  });

  it('rechaza cuando el secreto no está configurado', () => {
    expect(firmaValida(cuerpo, firmar(cuerpo), '')).toBe(false);
  });

  it('rechaza una firma de longitud distinta sin comparar contenido', () => {
    expect(firmaValida(cuerpo, 'sha256=abc123', SECRETO)).toBe(false);
  });
});

describe('Verificación del webhook al registrarlo en Meta', () => {
  it('devuelve el challenge con el token correcto', () => {
    const r = respuestaDeVerificacion(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'token-ok', 'hub.challenge': '12345' },
      'token-ok',
    );
    expect(r).toBe('12345');
  });

  it('rechaza un token incorrecto', () => {
    const r = respuestaDeVerificacion(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'malo', 'hub.challenge': '12345' },
      'token-ok',
    );
    expect(r).toBeNull();
  });

  it('rechaza un modo distinto de subscribe', () => {
    const r = respuestaDeVerificacion(
      { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'token-ok', 'hub.challenge': '12345' },
      'token-ok',
    );
    expect(r).toBeNull();
  });

  it('rechaza cuando el token esperado está vacío', () => {
    const r = respuestaDeVerificacion(
      { 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '12345' },
      '',
    );
    expect(r).toBeNull();
  });
});
