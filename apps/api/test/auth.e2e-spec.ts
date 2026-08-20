import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Prueba de cierre de la Fase 0 (Guía §2, FASE 0):
 *   · login de cada rol devuelve token con el rol correcto
 *   · acceso denegado sin token
 *
 * Requiere el seed cargado. El límite de login se eleva desde test/setup-e2e.ts
 * porque la suite hace más intentos por minuto de los que permite producción (5/min);
 * el límite en sí se prueba en el endurecimiento de la Fase 6.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PASSWORD = 'Provivir2026!';
  const CUENTAS = [
    { email: 'admin@provivir.local', rol: 'admin' },
    { email: 'asistente@provivir.local', rol: 'asistente' },
    { email: 'osorio@provivir.local', rol: 'prestador' },
    { email: 'pantalla@provivir.local', rol: 'pantalla' },
  ] as const;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    prisma = app.get(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('el seed está cargado (4 usuarios, uno por rol)', async () => {
    await expect(prisma.usuario.count()).resolves.toBe(4);
  });

  describe('login por rol', () => {
    it.each(CUENTAS)('$rol: recibe token con el rol correcto', async ({ email, rol }) => {
      const r = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);

      expect(r.body.accessToken).toEqual(expect.any(String));
      expect(r.body.refreshToken).toEqual(expect.any(String));
      expect(r.body.usuario.rol).toBe(rol);

      // El token debe declarar el rol: los guards de la Fase 3 dependen de esto.
      const payload = JSON.parse(Buffer.from(r.body.accessToken.split('.')[1], 'base64url').toString());
      expect(payload.rol).toBe(rol);
      expect(payload.sedeId).toBe('cdc-oriente');
    });

    it('RN-06.2: el usuario prestador queda atado a su ficha de prestador', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'osorio@provivir.local', password: PASSWORD })
        .expect(200);

      expect(r.body.usuario.prestadorId).toBe('ao');
    });

    it('el token NO transporta PII (documento ni teléfono)', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@provivir.local', password: PASSWORD })
        .expect(200);

      const payload = Buffer.from(r.body.accessToken.split('.')[1], 'base64url').toString();
      expect(payload).not.toMatch(/documento|telefono|email/i);
    });
  });

  describe('acceso denegado', () => {
    it('sin token → 401', async () => {
      await request(app.getHttpServer()).get('/api/auth/yo').expect(401);
    });

    it('con token inválido → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/auth/yo')
        .set('Authorization', 'Bearer no-es-un-token')
        .expect(401);
    });

    it('con token válido → devuelve el usuario', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'asistente@provivir.local', password: PASSWORD })
        .expect(200);

      const r = await request(app.getHttpServer())
        .get('/api/auth/yo')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      expect(r.body.rol).toBe('asistente');
    });

    it('contraseña incorrecta → 401 sin revelar si la cuenta existe', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@provivir.local', password: 'ContraseñaIncorrecta1' })
        .expect(401);

      expect(r.body.message).toBe('Credenciales inválidas');
    });

    it('cuenta inexistente → mismo mensaje que contraseña incorrecta (sin enumeración)', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'noexiste@provivir.local', password: 'ContraseñaIncorrecta1' })
        .expect(401);

      expect(r.body.message).toBe('Credenciales inválidas');
    });

    it('rechaza cuerpos con campos no declarados', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@provivir.local', password: PASSWORD, rol: 'admin' })
        .expect(400);
    });

    it('rechaza un correo con formato inválido', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'no-es-correo', password: PASSWORD })
        .expect(400);
    });
  });

  describe('health', () => {
    it('/api/health responde sin token', async () => {
      const r = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(r.body.estado).toBe('ok');
    });

    it('/api/health/ready confirma que la base responde', async () => {
      const r = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
      expect(r.body).toEqual({ estado: 'ok', db: 'ok' });
    });
  });
});
