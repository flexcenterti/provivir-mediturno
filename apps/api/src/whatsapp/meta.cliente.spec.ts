import { ConfigService } from '@nestjs/config';
import { DestinatarioSinTelefono, FueraDeVentanaMeta, MetaCliente } from './meta.cliente';

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

  /**
   * `131047` es el único rechazo con una salida concreta —mandar una plantilla— así
   * que tiene que distinguirse del resto. Confundirlo con un token vencido le enseña
   * a la asistente un «500» donde debería leer qué hacer.
   */
  describe('rechazos de Meta', () => {
    const rechazarCon = (status: number, cuerpo: string) => {
      global.fetch = jest.fn(async () => ({
        ok: false, status, text: async () => cuerpo,
      })) as unknown as typeof fetch;
    };

    it('el 131047 se distingue del rechazo genérico', async () => {
      rechazarCon(400, JSON.stringify({
        error: { code: 131047, message: 'Re-engagement message' },
      }));
      await expect(cliente.enviarTexto('+573001112222', 'hola')).rejects.toBeInstanceOf(FueraDeVentanaMeta);
    });

    it('otro código sigue siendo un error genérico', async () => {
      rechazarCon(401, JSON.stringify({ error: { code: 190, message: 'Token expirado' } }));
      const fallo = cliente.enviarTexto('+573001112222', 'hola');
      await expect(fallo).rejects.not.toBeInstanceOf(FueraDeVentanaMeta);
      await expect(fallo).rejects.toThrow('Meta rechazó el envío (401)');
    });

    it('un rechazo ilegible no rompe el manejo del error', async () => {
      rechazarCon(502, '<html>Bad Gateway</html>');
      await expect(cliente.enviarTexto('+573001112222', 'hola')).rejects.toThrow('Meta rechazó el envío (502)');
    });

    /**
     * La ventana cerrada no depende de cómo se identifique el destinatario. Si se
     * envolviera en `DestinatarioSinTelefono`, quien la reciba escalaría a una
     * persona en vez de ofrecer la plantilla, que es lo que sí resuelve el caso.
     */
    it('con un nombre de usuario, la ventana cerrada no se disfraza de destinatario sin teléfono', async () => {
      rechazarCon(400, JSON.stringify({ error: { code: 131047 } }));
      const fallo = cliente.enviarTexto('wa:CO.13491208655302741918', 'hola');
      await expect(fallo).rejects.toBeInstanceOf(FueraDeVentanaMeta);
      await expect(fallo).rejects.not.toBeInstanceOf(DestinatarioSinTelefono);
    });
  });
});
