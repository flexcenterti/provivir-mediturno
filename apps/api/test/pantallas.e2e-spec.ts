import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TurnosService } from '../src/turnos/turnos.service';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hoyEnSede, SEDE_ID } from '@provivir/shared';

/**
 * Pantallas de sala contra base real (RN-11).
 *
 * El módulo llevaba desde la fase 3 sin una sola prueba de integración, y con cero
 * filas en producción. Lo que se fija aquí es lo que solo se rompe con base: que crear
 * y retirar funcionen de verdad, que retirar sea la revocación del enlace en TODAS sus
 * rutas de lectura, y que el estado público sea el del día.
 */
describe('Pantallas de sala (integración)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let turnos: TurnosService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const DOC = '9622';
  const CLAVE = 'Provivir2026!';
  const PREFIJO = 'PE · ';

  let pacienteId: string;
  let contador = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

    prisma = app.get(PrismaService);
    turnos = app.get(TurnosService);
    await app.init();
    http = app.getHttpServer();

    const p = await prisma.paciente.upsert({
      where: { documento: `${DOC}0001` },
      update: {},
      create: { documento: `${DOC}0001`, nombres: 'Ana', apellidos: 'Pantalla', sedeId: SEDE_ID },
    });
    pacienteId = p.id;
  });

  afterAll(async () => {
    await limpiar();
    await prisma.paciente.deleteMany({ where: { documento: { startsWith: DOC } } });
    await app.close();
  });

  beforeEach(limpiar);

  async function limpiar() {
    await prisma.cita.deleteMany({ where: { paciente: { documento: { startsWith: DOC } } } });
    await prisma.pantalla.deleteMany({ where: { nombre: { startsWith: PREFIJO } } });
  }

  const token = async (email: string): Promise<string> => {
    const r = await request(http).post('/api/auth/login').send({ email, password: CLAVE }).expect(200);
    return r.body.accessToken;
  };

  const admin = () => token('admin@provivir.local');

  /** Un turno ya llamado, para poblar el estado público. */
  async function llamado(servicioId: 'mg' | 'lab', opciones: { dias?: number } = {}) {
    const fecha = new Date(hoyEnSede().getTime() + (opciones.dias ?? 0) * 86_400_000);
    const cita = await prisma.cita.create({
      data: {
        codigo: `P${String(++contador).padStart(4, '0')}`,
        pacienteId, prestadorId: 'ao', servicioId, tipo: 'general',
        fecha, horaInicio: 480 + contador, duracionMin: 15,
        estado: 'en_atencion', origen: 'mostrador', sedeId: SEDE_ID,
      },
    });
    return prisma.turno.create({
      data: { citaId: cita.id, prioridad: 'baja', estado: 'llamado', llamadoTs: new Date(), consultorio: '2' },
    });
  }

  describe('crear', () => {
    /*
     * Mata: fijar valores en el create en vez de dejar los defaults del esquema
     * (`turnosVisibles: 0`, `sonido: false`). La pantalla nacería inservible y no se
     * notaría hasta tenerla colgada en la sala.
     */
    it('nace con los valores por defecto del esquema y en la sede única', async () => {
      const t = await admin();
      const r = await request(http).post('/api/pantallas')
        .set('Authorization', `Bearer ${t}`)
        .send({ nombre: `${PREFIJO}Sala nueva` })
        .expect(201);

      expect(r.body).toMatchObject({
        nombre: `${PREFIJO}Sala nueva`, servicios: [], turnosVisibles: 4,
        sonido: true, media: false, intervaloInstitucionalMin: 10,
      });
      const guardada = await prisma.pantalla.findUnique({ where: { id: r.body.id } });
      // Mata: aceptar `sedeId` del cuerpo — sería el primer sitio donde el cliente
      // elige sede, contra D1.
      expect(guardada?.sedeId).toBe(SEDE_ID);
    });

    /*
     * Mata: saltarse la validación de servicios. Una pantalla con un id que no existe
     * no recibe un solo llamado en toda su vida y se queda en «Esperando llamados»,
     * que es indistinguible de una sala tranquila. La aserción mira el mensaje porque
     * validar sin decir CUÁL sobra deja al operador adivinando.
     */
    it('rechaza un servicio que no está en el catálogo, y dice cuál', async () => {
      const t = await admin();
      const r = await request(http).post('/api/pantallas')
        .set('Authorization', `Bearer ${t}`)
        // Ojo con el id elegido: `derp` y `vitc` SÍ existen en el catálogo de
        // demostración que siembra esta base, y con ellos la prueba pasaría por la
        // razón contraria.
        .send({ nombre: `${PREFIJO}Mala`, servicios: ['mg', 'no-existe-este'] })
        .expect(400);

      expect(r.body.message).toContain('no-existe-este');
      expect(r.body.message).not.toContain('mg,');
    });

    /*
     * Mata: añadir `@ArrayNotEmpty()`. Una pantalla recién creada y todavía sin
     * configurar es legítima; el aviso vive en la interfaz y en el propio televisor,
     * no en un 400 que impediría el flujo normal de alta.
     */
    it('sin servicios se puede crear: es el estado normal al darla de alta', async () => {
      const t = await admin();
      await request(http).post('/api/pantallas')
        .set('Authorization', `Bearer ${t}`)
        .send({ nombre: `${PREFIJO}A medias`, servicios: [] })
        .expect(201);
    });

    /*
     * Mata: dejar el decorador en `pantallas.ver`, que la asistente sí tiene. Podría
     * dar de alta y retirar televisores de la sala.
     */
    it('la asistente puede verlas pero no crearlas', async () => {
      const t = await token('asistente@provivir.local');
      await request(http).get('/api/pantallas').set('Authorization', `Bearer ${t}`).expect(200);
      await request(http).post('/api/pantallas')
        .set('Authorization', `Bearer ${t}`).send({ nombre: `${PREFIJO}X` }).expect(403);
    });
  });

  describe('editar', () => {
    /*
     * Mata: validar solo al crear. Sería la misma trampa entrando por la otra puerta,
     * y la que se usa a diario.
     */
    it('el PATCH también rechaza un servicio inexistente', async () => {
      const t = await admin();
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Editable`, servicios: ['mg'], sedeId: SEDE_ID },
      });

      await request(http).patch(`/api/pantallas/${p.id}`)
        .set('Authorization', `Bearer ${t}`).send({ servicios: ['tampoco-existe'] }).expect(400);
    });
  });

  describe('retirar es revocar el enlace (RN-11.6)', () => {
    /*
     * Mata: borrado lógico (`activo: false`) sin filtrar en el estado público. La
     * pantalla saldría de la lista y el televisor filtrado seguiría funcionando — el
     * fallo exacto que el procedimiento del Caddyfile existe para evitar. Por eso la
     * aserción es sobre `/estado`, no sobre el conteo de filas.
     */
    it('el enlace deja de resolver', async () => {
      const t = await admin();
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Filtrada`, servicios: ['mg'], sedeId: SEDE_ID },
      });
      await request(http).get(`/api/pantallas/${p.id}/estado`).expect(200);

      await request(http).delete(`/api/pantallas/${p.id}`)
        .set('Authorization', `Bearer ${t}`).expect(204);

      await request(http).get(`/api/pantallas/${p.id}/estado`).expect(404);
    });

    /*
     * Mata: el borrado lógico olvidando el filtro en `turnos.service`, que es la
     * tercera ruta de lectura y la que nadie recuerda. Una pantalla «retirada»
     * seguiría recibiendo nombres de pacientes en vivo por el WebSocket.
     */
    it('y deja de estar entre los destinatarios de un llamado', async () => {
      const t = await admin();
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Destinataria`, servicios: ['mg'], sedeId: SEDE_ID },
      });

      const antes = await prisma.pantalla.findMany({ where: { servicios: { has: 'mg' } } });
      expect(antes.map((x) => x.id)).toContain(p.id);

      await request(http).delete(`/api/pantallas/${p.id}`)
        .set('Authorization', `Bearer ${t}`).expect(204);

      const despues = await prisma.pantalla.findMany({ where: { servicios: { has: 'mg' } } });
      expect(despues.map((x) => x.id)).not.toContain(p.id);
    });

    /* Mata: `deleteMany`, que responde 204 alegremente sobre nada. */
    it('retirar una que no existe es 404', async () => {
      const t = await admin();
      await request(http).delete('/api/pantallas/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${t}`).expect(404);
    });

    /*
     * Mata: quitar la auditoría. Es la única recuperación que tiene el borrado duro;
     * sin la configuración serializada, rehacer la pantalla es adivinar.
     */
    it('queda auditada con la configuración entera', async () => {
      const t = await admin();
      const p = await prisma.pantalla.create({
        data: {
          nombre: `${PREFIJO}Con historia`, servicios: ['mg', 'lab'],
          canalYoutube: 'UC2Xq2PK-got3Rtz9ZJ32hLQ', sedeId: SEDE_ID,
        },
      });

      await request(http).delete(`/api/pantallas/${p.id}`)
        .set('Authorization', `Bearer ${t}`).expect(204);

      const a = await prisma.auditoria.findFirst({ where: { entidad: `pantalla/${p.id}` } });
      expect(a?.accion).toBe('Pantalla retirada');
      expect(JSON.parse(a?.detalle ?? '{}')).toMatchObject({
        nombre: `${PREFIJO}Con historia`,
        servicios: ['mg', 'lab'],
        canalYoutube: 'UC2Xq2PK-got3Rtz9ZJ32hLQ',
      });
    });

    /* Mata: dejar el DELETE en `pantallas.ver`. */
    it('la asistente no puede retirar', async () => {
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Protegida`, servicios: [], sedeId: SEDE_ID },
      });
      const t = await token('asistente@provivir.local');
      await request(http).delete(`/api/pantallas/${p.id}`)
        .set('Authorization', `Bearer ${t}`).expect(403);
    });
  });

  /**
   * RN-11.7 · Los anuncios de la franja del televisor.
   *
   * Es la primera vez que el sistema sirve bytes subidos por un usuario desde un
   * endpoint público sin autenticar. Es una clase de superficie nueva, no una más.
   */
  describe('anuncios de sala', () => {
    // Un PNG de 1×1 de verdad: la validación mira la firma, no la extensión.
    const PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const DIR = join(process.env.DIR_MEDIA || 'media', 'anuncios');

    async function limpiarAnuncios() {
      await prisma.anuncioSala.deleteMany({ where: { sedeId: SEDE_ID } });
    }

    const subir = async (contenido: Buffer, nombre = 'cartel.png') => {
      const t = await admin();
      return request(http).post('/api/pantallas/anuncios')
        .set('Authorization', `Bearer ${t}`)
        .attach('archivo', contenido, nombre);
    };

    beforeEach(limpiarAnuncios);
    afterAll(limpiarAnuncios);

    /*
     * Mata: poner una guarda de permisos en `GET /:id/imagen`. La franja saldría vacía
     * en todos los televisores y perfecta en el backoffice, que es la peor combinación
     * posible para diagnosticarlo.
     */
    it('una imagen subida se consulta SIN sesión', async () => {
      const r = await subir(PNG);
      expect(r.status).toBe(201);

      const img = await request(http).get(`/api/pantallas/anuncios/${r.body.id}/imagen`).expect(200);
      expect(img.headers['content-type']).toBe('image/png');
      expect(Buffer.from(img.body)).toEqual(PNG);
    });

    /*
     * Mata: confiar en que ya lo pone Caddy. En `:3000` —desarrollo y esta misma
     * suite— no lo pone nadie, y este endpoint sirve bytes de un usuario sin autenticar.
     */
    it('se sirve con nosniff y cacheable un año', async () => {
      const r = await subir(PNG);
      const img = await request(http).get(`/api/pantallas/anuncios/${r.body.id}/imagen`).expect(200);

      expect(img.headers['x-content-type-options']).toBe('nosniff');
      // Al revés que el adjunto de un paciente, que es `private, no-store`: un id apunta
      // a un archivo fijo para siempre. Mata copiar de `bandeja` sin pensarlo.
      expect(img.headers['cache-control']).toContain('public');
      expect(img.headers['cache-control']).toContain('immutable');
    });

    /*
     * Mata: validar solo por la extensión, que es lo que hacen hoy los otros dos
     * endpoints de subida del sistema. Y mata también guardar el archivo antes de
     * validarlo: se comprueba que el directorio no ganó ninguno.
     */
    it('un archivo con extensión de imagen y contenido falso da 400 y no deja nada en disco', async () => {
      const antes = existsSync(DIR) ? (await import('node:fs/promises')).readdir(DIR) : Promise.resolve([]);
      const cuantosAntes = (await antes).length;

      const r = await subir(Buffer.from('<!doctype html><script>alert(1)</script>'), 'malo.png');
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/no es una imagen/i);

      const despues = existsSync(DIR) ? await (await import('node:fs/promises')).readdir(DIR) : [];
      expect(despues.length).toBe(cuantosAntes);
      expect(await prisma.anuncioSala.count({ where: { sedeId: SEDE_ID } })).toBe(0);
    });

    /*
     * Mata: dejar el tope solo en la interfaz. Cinco carteles lado a lado en un
     * televisor no se leen. Y afirmar el 409 concreto mata cambiarlo por un 400: la
     * petición está bien formada, lo que lo impide es el estado del recurso.
     */
    it('el quinto anuncio da 409 y no crea fila', async () => {
      for (let i = 0; i < 4; i++) expect((await subir(PNG, `c${i}.png`)).status).toBe(201);

      const r = await subir(PNG, 'quinto.png');
      expect(r.status).toBe(409);
      expect(await prisma.anuncioSala.count({ where: { sedeId: SEDE_ID } })).toBe(4);
    });

    /*
     * Mata: borrar solo la fila. Los bytes se quedarían para siempre en un volumen que
     * nadie mira, y esta es la única prueba que lo ve.
     */
    it('retirar borra la fila y el archivo del disco', async () => {
      const r = await subir(PNG);
      const fila = await prisma.anuncioSala.findUniqueOrThrow({ where: { id: r.body.id } });
      const ruta = join(DIR, fila.archivo);
      expect(existsSync(ruta)).toBe(true);

      const t = await admin();
      await request(http).delete(`/api/pantallas/anuncios/${r.body.id}`)
        .set('Authorization', `Bearer ${t}`).expect(204);

      expect(existsSync(ruta)).toBe(false);
      await request(http).get(`/api/pantallas/anuncios/${r.body.id}/imagen`).expect(404);
    });

    /*
     * Mata: construir la ruta antes de comprobar que la fila existe. `join(dir,
     * undefined)` lanza, y un endpoint público devolvería 500 donde tocaba un 404.
     */
    it('un id que no existe da 404, no un error del servidor', async () => {
      await request(http)
        .get('/api/pantallas/anuncios/00000000-0000-0000-0000-000000000000/imagen')
        .expect(404);
    });

    /* Mata: dejar la subida o el retiro en `pantallas.ver`, que la asistente tiene. */
    it('subir y retirar exigen pantallas.editar', async () => {
      const t = await token('asistente@provivir.local');
      await request(http).post('/api/pantallas/anuncios')
        .set('Authorization', `Bearer ${t}`).attach('archivo', PNG, 'x.png').expect(403);

      const propio = await subir(PNG);
      await request(http).delete(`/api/pantallas/anuncios/${propio.body.id}`)
        .set('Authorization', `Bearer ${t}`).expect(403);
    });

    /*
     * Mata: reordenar sin transacción, o intercambiar solo los dos valores que se
     * cruzan. Lo segundo no movería nada cuando los `orden` heredados están repetidos.
     */
    it('mover a la izquierda intercambia con el vecino y persiste', async () => {
      const a = await subir(PNG, 'a.png');
      const b = await subir(PNG, 'b.png');
      const t = await admin();

      const r = await request(http).patch(`/api/pantallas/anuncios/${b.body.id}/mover`)
        .set('Authorization', `Bearer ${t}`).send({ direccion: 'izquierda' }).expect(200);

      expect(r.body.map((x: { id: string }) => x.id)).toEqual([b.body.id, a.body.id]);
      const guardados = await prisma.anuncioSala.findMany({
        where: { sedeId: SEDE_ID }, orderBy: { orden: 'asc' },
      });
      expect(guardados.map((x) => x.id)).toEqual([b.body.id, a.body.id]);
    });

    /* Mata: mover el primero a la izquierda y romper, en vez de no hacer nada. */
    it('mover más allá del borde no hace nada', async () => {
      const a = await subir(PNG, 'a.png');
      const t = await admin();
      const r = await request(http).patch(`/api/pantallas/anuncios/${a.body.id}/mover`)
        .set('Authorization', `Bearer ${t}`).send({ direccion: 'izquierda' }).expect(200);
      expect(r.body).toHaveLength(1);
    });
  });

  describe('el estado que consume el televisor', () => {
    /*
     * Mata: quitar `cita: { fecha: hoyEnSede() }` de `ultimosLlamados`. Nadie escribe
     * nunca `ausente`, así que un turno llamado y no finalizado se queda en `llamado`
     * para siempre: el televisor amanecería mostrando el llamado de ayer. No mordía
     * porque nunca se había llamado a nadie en producción.
     */
    it('no muestra el llamado de ayer', async () => {
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Hoy`, servicios: ['mg'], sedeId: SEDE_ID },
      });
      const ayer = await llamado('mg', { dias: -1 });
      const hoy = await llamado('mg');

      const r = await request(http).get(`/api/pantallas/${p.id}/estado`).expect(200);
      const ids = r.body.llamados.map((l: { turnoId: string }) => l.turnoId);
      expect(ids).toContain(hoy.id);
      expect(ids).not.toContain(ayer.id);
    });

    /* Mata: quitar `turnoId` del mapeo → la TV no puede deduplicar ni retirar. */
    it('cada llamado trae su turnoId, que es la clave que usa la TV', async () => {
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Claves`, servicios: ['mg'], sedeId: SEDE_ID },
      });
      const t = await llamado('mg');

      const r = await request(http).get(`/api/pantallas/${p.id}/estado`).expect(200);
      expect(r.body.llamados[0].turnoId).toBe(t.id);
    });

    /*
     * Mata: quitar `servicios` del estado. Sin él la TV no puede distinguir una
     * pantalla sin configurar de una sala tranquila, y se queda en «Esperando
     * llamados» para siempre sin decir por qué.
     */
    it('dice qué servicios tiene, para que el televisor pueda avisar si no tiene ninguno', async () => {
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Vacía`, servicios: [], sedeId: SEDE_ID },
      });
      const r = await request(http).get(`/api/pantallas/${p.id}/estado`).expect(200);
      expect(r.body.pantalla.servicios).toEqual([]);
    });

    /* Mata: filtrar mal por servicio → la sala del laboratorio anuncia ginecología. */
    it('solo trae los llamados de sus servicios (RN-11.1)', async () => {
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Solo lab`, servicios: ['lab'], sedeId: SEDE_ID },
      });
      await llamado('mg');
      const suyo = await llamado('lab');

      const r = await request(http).get(`/api/pantallas/${p.id}/estado`).expect(200);
      expect(r.body.llamados.map((l: { turnoId: string }) => l.turnoId)).toEqual([suyo.id]);
    });

    /*
     * Mata: quitar el `orderBy` del listado. Postgres devuelve el orden físico, que
     * coincide con el de inserción HASTA EL PRIMER UPDATE: el defecto aparecería
     * semanas después, la primera vez que alguien reordene la franja.
     */
    it('los anuncios llegan en el orden guardado', async () => {
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Con anuncios`, servicios: ['mg'], sedeId: SEDE_ID },
      });
      await prisma.anuncioSala.createMany({
        data: [
          { archivo: 'aaaaaaaa-0000-4000-8000-000000000001.png', mime: 'image/png', bytes: 1, nombreOriginal: 'segundo', orden: 1, sedeId: SEDE_ID },
          { archivo: 'aaaaaaaa-0000-4000-8000-000000000002.png', mime: 'image/png', bytes: 1, nombreOriginal: 'primero', orden: 0, sedeId: SEDE_ID },
        ],
      });

      const r = await request(http).get(`/api/pantallas/${p.id}/estado`).expect(200);
      const nombres = await prisma.anuncioSala.findMany({ orderBy: { orden: 'asc' } });
      expect(r.body.anuncios.map((a: { id: string }) => a.id)).toEqual(nombres.map((n) => n.id));
      expect(r.body.anuncios[0].url).toBe(`/api/pantallas/anuncios/${nombres[0]!.id}/imagen`);

      await prisma.anuncioSala.deleteMany({ where: { sedeId: SEDE_ID } });
    });

    /*
     * Mata: meter `ahora` dentro de `pantalla`. La TV compara ese objeto para no
     * reemplazar la configuración cuando no cambió; con la hora dentro no coincidiría
     * jamás y el reproductor de YouTube se recrearía cada 60 s, matando los videos
     * institucionales de más de un minuto. Es un defecto de la TV que solo se puede
     * cazar desde aquí.
     */
    it('la hora del servidor viaja fuera de `pantalla`, no dentro', async () => {
      const p = await prisma.pantalla.create({
        data: { nombre: `${PREFIJO}Con hora`, servicios: ['mg'], sedeId: SEDE_ID },
      });
      const r = await request(http).get(`/api/pantallas/${p.id}/estado`).expect(200);

      expect(typeof r.body.ahora).toBe('string');
      expect(Math.abs(new Date(r.body.ahora).getTime() - Date.now())).toBeLessThan(10_000);
      expect(r.body.pantalla).not.toHaveProperty('ahora');
      expect(r.body.pantalla).not.toHaveProperty('anuncios');
    });

    /* Sin este uso, `turnos` quedaría importado y sin utilidad en la suite. */
    it('el servicio y el endpoint devuelven lo mismo', async () => {
      const t = await llamado('mg');
      const directo = await turnos.ultimosLlamados(['mg'], 4);
      expect(directo.map((x) => x.id)).toContain(t.id);
    });
  });
});
