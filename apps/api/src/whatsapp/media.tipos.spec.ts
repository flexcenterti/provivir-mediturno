import { extensionDe, mimeDeExtension } from './media.tipos';

describe('media.tipos', () => {
  it('guarda cada tipo que entrega Meta con su extensión', () => {
    expect(extensionDe('image/jpeg')).toBe('.jpg');
    expect(extensionDe('application/pdf')).toBe('.pdf');
    // Meta manda el charset pegado al tipo en las notas de voz.
    expect(extensionDe('audio/ogg; codecs=opus')).toBe('.ogg');
  });

  it('la conversión es de ida y vuelta: lo que se guarda se sirve con su mismo tipo', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'audio/ogg', 'video/mp4']) {
      expect(mimeDeExtension(`media/${crypto.randomUUID()}${extensionDe(mime)}`)).toBe(mime);
    }
  });

  it('lo desconocido se sirve como binario, nunca como algo que el navegador ejecute', () => {
    expect(extensionDe(undefined)).toBe('.bin');
    expect(mimeDeExtension('media/algo.bin')).toBe('application/octet-stream');
    expect(mimeDeExtension('media/algo.html')).toBe('application/octet-stream');
  });
});
