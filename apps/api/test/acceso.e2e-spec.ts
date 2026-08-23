import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AccesoService } from '../src/acceso/acceso.service';

/**
 * Perfiles de acceso y usuarios.
 *
 * Lo que se protege aquí no es el CRUD sino tres invariantes que, si se rompen,
 * dejan el sistema sin salida o abierto de más. Se verificaron a mano contra la API
 * en vivo al construirlos; esto impide que un refactor los deshaga en silencio.
 *
 * Requiere el seed cargado (crea los cuatro perfiles base y un admin).
 */
describe('Acceso · perfiles y usuarios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let idAdministracion: string;

  const creados: string[] = [];
  const perfilesCreados: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    prisma = app.get(PrismaService);
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'admin@provivir.local', password: 'Provivir2026!' });
    token = login.body.accessToken;

    const perfiles = await request(app.getHttpServer())
      .get('/api/acceso/perfiles').set('Authorization', `Bearer ${token}`);
    idAdministracion = perfiles.body.find((p: { nombre: string }) => p.nombre === 'Administración').id;
  });

  afterAll(async () => {
    // Se limpia lo creado para no ensuciar la base entre corridas.
    if (creados.length) await prisma.usuario.deleteMany({ where: { id: { in: creados } } });
    if (perfilesCreados.length) await prisma.perfil.deleteMany({ where: { id: { in: perfilesCreados } } });
    await app.close();
  });

  const conToken = () => request(app.getHttpServer());
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  describe('los perfiles base', () => {
    it('se crean solos y cubren los cuatro roles anteriores', async () => {
      const r = await auth(conToken().get('/api/acceso/perfiles')).expect(200);
      const nombres = r.body.map((p: { nombre: string }) => p.nombre);
      expect(nombres).toEqual(
        expect.arrayContaining(['Administración', 'Asistente', 'Médico', 'Pantalla de sala']),
      );
      expect(r.body.every((p: { sistema: boolean }) => typeof p.sistema === 'boolean')).toBe(true);
    });

    it('no se pueden eliminar, solo desactivar', async () => {
      const r = await auth(conToken().delete(`/api/acceso/perfiles/${idAdministracion}`)).expect(400);
      expect(r.body.message).toMatch(/no se eliminan/i);
    });
  });

  describe('un permiso que no existe no protege nada', () => {
    it('se rechaza al crear el perfil', async () => {
      const r = await auth(conToken().post('/api/acceso/perfiles'))
        .send({ nombre: 'Perfil imposible', permisos: ['borrar.todo'] })
        .expect(400);
      expect(JSON.stringify(r.body.message)).toMatch(/must be one of/i);
    });
  });

  describe('un perfil granular restringe de verdad', () => {
    let tokenLimitado: string;

    beforeAll(async () => {
      const perfil = await auth(conToken().post('/api/acceso/perfiles'))
        .send({
          nombre: `Solo lectura ${Date.now()}`,
          descripcion: 'Ve pacientes, nada más',
          permisos: ['pacientes.ver'],
        })
        .expect(201);
      perfilesCreados.push(perfil.body.id);

      const usuario = await auth(conToken().post('/api/acceso/usuarios'))
        .send({
          email: `limitado.${Date.now()}@prueba.local`,
          nombre: 'Usuario limitado',
          rol: 'asistente',
          perfilId: perfil.body.id,
        })
        .expect(201);
      creados.push(usuario.body.id);

      const login = await conToken().post('/api/auth/login')
        .send({ email: usuario.body.email, password: usuario.body.password });
      tokenLimitado = login.body.accessToken;
    });

    it('la contraseña emitida sirve para entrar', () => {
      expect(tokenLimitado).toBeTruthy();
    });

    it('entra a lo que su perfil concede', async () => {
      await conToken().get('/api/pacientes')
        .set('Authorization', `Bearer ${tokenLimitado}`).expect(200);
    });

    it('recibe 403 en lo que no concede', async () => {
      await conToken().get('/api/bandeja')
        .set('Authorization', `Bearer ${tokenLimitado}`).expect(403);
      await conToken().get('/api/auditoria')
        .set('Authorization', `Bearer ${tokenLimitado}`).expect(403);
    });

    it('no puede repartir permisos: eso concede todo lo demás', async () => {
      await conToken().get('/api/acceso/perfiles')
        .set('Authorization', `Bearer ${tokenLimitado}`).expect(403);
      await conToken().post('/api/acceso/perfiles')
        .set('Authorization', `Bearer ${tokenLimitado}`)
        .send({ nombre: 'x', permisos: [] }).expect(403);
    });

    it('quitarle el permiso surte efecto sin esperar a que expire su sesión', async () => {
      // Los permisos se resuelven en cada petición, no viven en el token.
      const perfilId = perfilesCreados[perfilesCreados.length - 1]!;
      await auth(conToken().patch(`/api/acceso/perfiles/${perfilId}`))
        .send({ permisos: ['metricas.ver'] }).expect(200);

      await conToken().get('/api/pacientes')
        .set('Authorization', `Bearer ${tokenLimitado}`).expect(403);

      await auth(conToken().patch(`/api/acceso/perfiles/${perfilId}`))
        .send({ permisos: ['pacientes.ver'] }).expect(200);
    });

    it('desactivar el perfil corta el acceso de todos sus usuarios a la vez', async () => {
      const perfilId = perfilesCreados[perfilesCreados.length - 1]!;
      await auth(conToken().patch(`/api/acceso/perfiles/${perfilId}`))
        .send({ activo: false }).expect(200);

      await conToken().get('/api/pacientes')
        .set('Authorization', `Bearer ${tokenLimitado}`).expect(403);

      await auth(conToken().patch(`/api/acceso/perfiles/${perfilId}`))
        .send({ activo: true }).expect(200);
    });

    it('un perfil con usuarios no se elimina hasta reasignarlos', async () => {
      const perfilId = perfilesCreados[perfilesCreados.length - 1]!;
      const r = await auth(conToken().delete(`/api/acceso/perfiles/${perfilId}`)).expect(409);
      expect(r.body.message).toMatch(/usuario/i);
    });
  });

  /**
   * El invariante que más importa: quedarse sin nadie que pueda gestionar usuarios
   * deja el sistema sin salida y solo se arregla entrando por consola.
   */
  describe('no se puede uno quedar sin administrador', () => {
    it('no se le quita `usuarios.gestionar` al único perfil que lo tiene', async () => {
      const r = await auth(conToken().patch(`/api/acceso/perfiles/${idAdministracion}`))
        .send({ permisos: ['pacientes.ver'] }).expect(409);
      expect(r.body.message).toMatch(/sin administrador/i);
    });

    it('no se desactiva ese perfil', async () => {
      const r = await auth(conToken().patch(`/api/acceso/perfiles/${idAdministracion}`))
        .send({ activo: false }).expect(409);
      expect(r.body.message).toMatch(/sin administrador/i);
    });

    it('no te puedes mover a ti mismo a un perfil sin gestión, siendo el único', async () => {
      /*
       * Este es el camino que de verdad queda abierto. Desactivarse a uno mismo ya
       * está bloqueado aparte, y desactivar a otro nunca deja el sistema huérfano
       * porque quien ejecuta la acción sigue estando. Pero cambiarse de perfil sí:
       * el sistema quedaría sin nadie que pueda repartir permisos.
       */
      const sinGestion = await auth(conToken().post('/api/acceso/perfiles'))
        .send({ nombre: `Sin gestión ${Date.now()}`, permisos: ['metricas.ver'] })
        .expect(201);
      perfilesCreados.push(sinGestion.body.id);

      const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: 'admin@provivir.local' } });
      const r = await auth(conToken().patch(`/api/acceso/usuarios/${admin.id}`))
        .send({ perfilId: sinGestion.body.id }).expect(409);
      expect(r.body.message).toMatch(/sin administrador/i);

      // Y sigue entrando: el cambio no se aplicó a medias.
      await auth(conToken().get('/api/acceso/perfiles')).expect(200);
    });

    it('nadie se desactiva a sí mismo, ni habiendo otro administrador', async () => {
      // Descubierto escribiendo esta prueba: la sesión muere en la misma petición,
      // así que ni siquiera se podía deshacer.
      const segundo = await auth(conToken().post('/api/acceso/usuarios'))
        .send({
          email: `segundo.${Date.now()}@prueba.local`,
          nombre: 'Segundo admin',
          rol: 'admin',
          perfilId: idAdministracion,
        })
        .expect(201);
      creados.push(segundo.body.id);

      const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: 'admin@provivir.local' } });
      const r = await auth(conToken().patch(`/api/acceso/usuarios/${admin.id}`))
        .send({ activo: false }).expect(409);
      expect(r.body.message).toMatch(/tu propia cuenta/i);
    });

    it('a OTRO administrador sí se le puede desactivar', async () => {
      const otro = await auth(conToken().post('/api/acceso/usuarios'))
        .send({
          email: `desechable.${Date.now()}@prueba.local`,
          nombre: 'Admin desechable',
          rol: 'admin',
          perfilId: idAdministracion,
        })
        .expect(201);
      creados.push(otro.body.id);

      await auth(conToken().patch(`/api/acceso/usuarios/${otro.body.id}`))
        .send({ activo: false }).expect(200);
    });
  });

  describe('la contraseña', () => {
    it('se emite al crear y no se puede volver a consultar', async () => {
      const u = await auth(conToken().post('/api/acceso/usuarios'))
        .send({
          email: `clave.${Date.now()}@prueba.local`,
          nombre: 'Prueba de clave',
          rol: 'asistente',
          perfilId: idAdministracion,
        })
        .expect(201);
      creados.push(u.body.id);

      expect(u.body.password).toHaveLength(21);

      // El listado nunca la devuelve: en la base solo vive su hash.
      const lista = await auth(conToken().get('/api/acceso/usuarios')).expect(200);
      expect(JSON.stringify(lista.body)).not.toContain(u.body.password);
      expect(JSON.stringify(lista.body)).not.toMatch(/hashPassword/);
    });

    it('reiniciarla emite una distinta y la anterior deja de servir', async () => {
      const id = creados[creados.length - 1]!;
      const antes = await prisma.usuario.findUniqueOrThrow({ where: { id } });
      const r = await auth(conToken().post(`/api/acceso/usuarios/${id}/clave`)).expect(201);
      const despues = await prisma.usuario.findUniqueOrThrow({ where: { id } });

      expect(r.body.password).toHaveLength(21);
      expect(despues.hashPassword).not.toBe(antes.hashPassword);
    });
  });

  describe('un permiso nuevo del catálogo llega a instalaciones ya desplegadas', () => {
    /**
     * El perfil de acceso completo se creó con la lista de permisos del día de la
     * instalación. Sin reconciliarlo, una función nueva se despliega y nadie puede
     * usarla: la pantalla existe y devuelve 403.
     */
    it('el perfil de acceso completo recupera los permisos que le falten', async () => {
      const acceso = app.get(AccesoService);

      // Se simula una instalación vieja: al perfil le faltan los permisos nuevos.
      const antes = await prisma.perfil.findUniqueOrThrow({ where: { nombre: 'Administración' } });
      const recortados = antes.permisos.filter((p) => !p.startsWith('conocimiento'));
      await prisma.perfil.update({ where: { nombre: 'Administración' }, data: { permisos: recortados } });

      await acceso.asegurarPerfilesBase();

      const despues = await prisma.perfil.findUniqueOrThrow({ where: { nombre: 'Administración' } });
      expect(despues.permisos).toEqual(expect.arrayContaining(['conocimiento.ver', 'conocimiento.editar']));
    });

    it('a los demás perfiles NO se les tocan los permisos: pueden haberlos ajustado', async () => {
      const acceso = app.get(AccesoService);

      const antes = await prisma.perfil.findUniqueOrThrow({ where: { nombre: 'Asistente' } });
      const recortados = antes.permisos.filter((p) => p !== 'mostrador.operar');
      await prisma.perfil.update({ where: { nombre: 'Asistente' }, data: { permisos: recortados } });

      await acceso.asegurarPerfilesBase();

      const despues = await prisma.perfil.findUniqueOrThrow({ where: { nombre: 'Asistente' } });
      expect(despues.permisos).not.toContain('mostrador.operar');

      await prisma.perfil.update({ where: { nombre: 'Asistente' }, data: { permisos: antes.permisos } });
    });
  });
});
