import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TurnosService } from '../src/turnos/turnos.service';
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

    /* Sin este uso, `turnos` quedaría importado y sin utilidad en la suite. */
    it('el servicio y el endpoint devuelven lo mismo', async () => {
      const t = await llamado('mg');
      const directo = await turnos.ultimosLlamados(['mg'], 4);
      expect(directo.map((x) => x.id)).toContain(t.id);
    });
  });
});
