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

  /**
   * `login` devolvía nombre y correo; `GET /auth/yo` devolvía permisos. El
   * backoffice usa el primero al entrar y el segundo al recargar, así que la
   * sesión cambiaba de forma bajo los pies del frontend.
   */
  describe('forma de la sesión', () => {
    it('RN-09: la sesión devuelve la misma forma al entrar y al recargar', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@provivir.local', password: PASSWORD })
        .expect(200);

      const yo = await request(app.getHttpServer())
        .get('/api/auth/yo')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);

      expect(Object.keys(yo.body).sort()).toEqual(Object.keys(login.body.usuario).sort());
      expect(yo.body).toEqual(login.body.usuario);
      expect(yo.body.nombre).toEqual(expect.any(String));
      expect(yo.body.nombre.length).toBeGreaterThan(0);
    });

    it('RN-09: la sesión incluye los permisos del perfil, no el rol a secas', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'asistente@provivir.local', password: PASSWORD })
        .expect(200);

      // El menú del backoffice se arma con esta lista.
      expect(login.body.usuario.permisos).toContain('metricas.ver');
      expect(login.body.usuario.permisos).toContain('bandeja.operar');
      expect(login.body.usuario.permisos).not.toContain('configuracion.editar');
      expect(login.body.usuario.permisos).not.toContain('auditoria.ver');
      expect(login.body.usuario.permisos).not.toContain('usuarios.gestionar');
    });

    /**
     * Los permisos salen de la FILA del perfil, no de `PERFILES_BASE`. Solo el
     * perfil de acceso completo se reconcilia al arrancar, así que un perfil base
     * creado antes de que existiera un permiso no lo recibe nunca. Es el caso de
     * `conocimiento.ver` en el perfil Asistente de esta instalación: el catálogo
     * dice que debería tenerlo y la fila no lo tiene. Se comprueba la regla, no el
     * dato concreto, para que la prueba no tape la deriva.
     */
    it('RN-09: los permisos salen del perfil guardado, no del catálogo de código', async () => {
      const perfil = await prisma.perfil.findUnique({ where: { nombre: 'Asistente' } });
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'asistente@provivir.local', password: PASSWORD })
        .expect(200);

      expect(login.body.usuario.permisos.sort()).toEqual([...perfil!.permisos].sort());
    });

    it('RN-09: el refresco devuelve la sesión completa, no solo los tokens', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@provivir.local', password: PASSWORD })
        .expect(200);

      const r = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: login.body.refreshToken })
        .expect(200);

      expect(r.body.usuario).toEqual(login.body.usuario);
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

  describe('renovación de la sesión', () => {
    const entrar = async () => {
      const r = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'asistente@provivir.local', password: PASSWORD })
        .expect(200);
      return r.body as { accessToken: string; refreshToken: string };
    };

    it('el refresco devuelve un par nuevo y el acceso nuevo sirve', async () => {
      const { refreshToken } = await entrar();

      const r = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(r.body.accessToken).toBeDefined();
      // Rota: el de refresco también es nuevo, y es lo que corre la ventana de inactividad.
      expect(r.body.refreshToken).toBeDefined();
      expect(r.body.refreshToken).not.toBe(refreshToken);

      await request(app.getHttpServer())
        .get('/api/auth/yo')
        .set('Authorization', `Bearer ${r.body.accessToken}`)
        .expect(200);
    });

    it('el token de refresco NO abre rutas protegidas', async () => {
      const { refreshToken } = await entrar();
      await request(app.getHttpServer())
        .get('/api/auth/yo')
        .set('Authorization', `Bearer ${refreshToken}`)
        .expect(401);
    });

    it('un token de acceso no sirve para refrescar', async () => {
      const { accessToken } = await entrar();
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: accessToken })
        .expect(401);
    });

    it('un refresco ilegible da 401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'esto.no.es.un.token.valido.de.ninguna.manera' })
        .expect(401);
    });

    it('el refresco no necesita sesión previa: es público', async () => {
      // Si exigiera token, la renovación sería imposible justo cuando hace falta.
      const r = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'x'.repeat(40) });
      expect(r.status).toBe(401);
      expect(r.body.message).toBe('Sesión expirada');
    });
  });

  describe('health', () => {
    it('/api/health responde sin token', async () => {
      const r = await request(app.getHttpServer()).get('/api/health').expect(200);
      expect(r.body.estado).toBe('ok');
    });

    it('/api/health/ready confirma que la base responde Y tiene el esquema', async () => {
      const r = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
      expect(r.body).toMatchObject({ estado: 'ok', db: 'ok' });
    });

    it('el readiness reporta si la configuración se cargó', async () => {
      const r = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
      expect(r.body.configuracion).toBe('ok');
    });
  });
});
