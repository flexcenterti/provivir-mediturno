import { ConfigService } from '@nestjs/config';
import { MetaCliente } from './meta.cliente';

/**
 * El destinatario viaja en un campo distinto según cómo se identifique. Poner el
 * identificador de nombre de usuario en `to` devuelve 131009 «The phone number is
 * malformed» y el paciente se queda sin respuesta.
 */
describe('MetaCliente · a dónde se dirige la respuesta', () => {
  const config = (v: Record<string, string>) =>
    ({ get: (k: string) => v[k] }) as unknown as ConfigService;

  const cliente = new MetaCliente(config({
    META_ACCESS_TOKEN: 'token', META_PHONE_NUMBER_ID: '123',
  }));

  let cuerpoEnviado: Record<string, unknown>;

  beforeEach(() => {
    cuerpoEnviado = {};
    global.fetch = jest.fn(async (_url: unknown, init: unknown) => {
      cuerpoEnviado = JSON.parse((init as { body: string }).body);
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.ok' }] }) };
    }) as unknown as typeof fetch;
  });

  it('un teléfono va en `to`', async () => {
    await cliente.enviarTexto('+573001112222', 'hola');
    expect(cuerpoEnviado).toMatchObject({ recipient_type: 'individual', to: '+573001112222' });
    expect(cuerpoEnviado).not.toHaveProperty('recipient');
  });

  it('un nombre de usuario va en `recipient`, sin la marca interna', async () => {
    await cliente.enviarTexto('wa:CO.13491208655302741918', 'hola');
    expect(cuerpoEnviado).toMatchObject({
      recipient_type: 'individual', recipient: 'CO.13491208655302741918',
    });
    // Si el identificador acaba en `to`, Meta responde 131009.
    expect(cuerpoEnviado).not.toHaveProperty('to');
  });

  it('la marca `wa:` nunca viaja a Meta', async () => {
    await cliente.enviarTexto('wa:CO.13491208655302741918', 'hola');
    expect(JSON.stringify(cuerpoEnviado)).not.toContain('wa:');
  });

  /**
   * Fuera de la ventana de 24 h esto es lo único que Meta acepta, así que la
   * forma de la carga importa: un `components` mal armado se rechaza entero.
   */
  it('la plantilla viaja con sus parámetros posicionales, en orden', async () => {
    await cliente.enviarPlantilla('+573001112222', 'recordatorio_24h', ['C-1', 'Ecografía', '2026-09-08', '09:20']);

    expect(cuerpoEnviado).toMatchObject({
      to: '+573001112222',
      type: 'template',
      template: {
        name: 'recordatorio_24h',
        language: { code: 'es' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: 'C-1' },
            { type: 'text', text: 'Ecografía' },
            { type: 'text', text: '2026-09-08' },
            { type: 'text', text: '09:20' },
          ],
        }],
      },
    });
  });

  it('una plantilla sin variables no manda `components` vacío', async () => {
    await cliente.enviarPlantilla('+573001112222', 'aviso_simple', []);
    expect(cuerpoEnviado.template).not.toHaveProperty('components');
  });
});
