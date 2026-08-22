import { interpretarYoutube, urlEmbedDirecto } from '../youtube';

describe('Qué pega el administrador en el campo de YouTube', () => {
  const CANAL = 'UC2Xq2PK-got3Rtz9ZJ32hLQ';

  it('reconoce el id del canal en cualquiera de sus formas', () => {
    for (const v of [
      CANAL,
      `https://www.youtube.com/channel/${CANAL}`,
      `https://www.youtube.com/channel/${CANAL}/live`,
      `https://www.youtube.com/embed/live_stream?channel=${CANAL}`,
    ]) {
      expect(interpretarYoutube(v)).toEqual({ tipo: 'directo', canalId: CANAL });
    }
  });

  it('explica qué hacer con un @handle en vez de fallar en negro', () => {
    // No se puede resolver desde el navegador: exige la API de datos de YouTube.
    const r = interpretarYoutube('https://www.youtube.com/@NoticiasCaracol/live');
    expect(r.tipo).toBe('invalida');
    expect(r.tipo === 'invalida' && r.motivo).toMatch(/ID del canal/i);
    expect(r.tipo === 'invalida' && r.motivo).toContain('@NoticiasCaracol');
  });

  it('reconoce un video en sus formatos habituales', () => {
    for (const v of [
      'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
      'https://youtu.be/aqz-KE-bpKQ',
      'https://www.youtube.com/embed/aqz-KE-bpKQ',
      'aqz-KE-bpKQ',
    ]) {
      expect(interpretarYoutube(v)).toEqual({ tipo: 'video', videoId: 'aqz-KE-bpKQ' });
    }
  });

  it('el campo vacío no es un error de formato', () => {
    expect(interpretarYoutube('')).toMatchObject({ tipo: 'invalida', motivo: 'Sin configurar' });
    expect(interpretarYoutube(null)).toMatchObject({ tipo: 'invalida' });
  });

  it('cualquier otra cosa se rechaza en vez de intentarse', () => {
    expect(interpretarYoutube('https://vimeo.com/12345').tipo).toBe('invalida');
    expect(interpretarYoutube('noticias caracol').tipo).toBe('invalida');
  });

  it('el embed del directo va silenciado: si no, el navegador lo bloquea', () => {
    const url = urlEmbedDirecto(CANAL);
    expect(url).toContain('live_stream');
    expect(url).toContain(`channel=${CANAL}`);
    expect(url).toContain('mute=1');
    expect(url).toContain('autoplay=1');
  });
});
