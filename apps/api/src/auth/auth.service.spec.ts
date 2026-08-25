import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { ConfigService } from '@nestjs/config';
import type { ConfiguracionService } from '../configuracion/configuracion.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from './auth.types';

const USUARIO = {
  id: 'u1', nombre: 'Ana Ruiz', email: 'ana@provivir.local', rol: 'asistente',
  sedeId: 'cdc-oriente', prestadorId: null, activo: true,
};

const jwt = new JwtService({ secret: 'secreto-de-pruebas-con-mas-de-32-caracteres' });

/** Solo lo que AuthService consulta al refrescar. */
const prismaCon = (usuario: unknown) =>
  ({ usuario: { findUnique: jest.fn().mockResolvedValue(usuario), update: jest.fn() } }) as unknown as PrismaService;

const entorno = { JWT_ACCESS_TTL: '15m', JWT_REFRESH_TTL: '7d' } as Record<string, string>;
const config = { getOrThrow: (k: string) => entorno[k] } as unknown as ConfigService;

const configuracionCon = (valores: Record<string, string> = {}) =>
  ({ texto: (clave: string, porDefecto: string) => valores[clave] ?? porDefecto }) as unknown as ConfiguracionService;

const armar = (usuario: unknown = USUARIO, valores: Record<string, string> = {}) =>
  new AuthService(prismaCon(usuario), jwt, config, configuracionCon(valores));

const leer = (token: string): JwtPayload & { exp: number; iat: number } =>
  jwt.verify(token, { secret: 'secreto-de-pruebas-con-mas-de-32-caracteres' });

const refrescoDe = async (servicio: AuthService) =>
  (await servicio.refrescar(await jwt.signAsync(
    { sub: 'u1', rol: 'asistente', sedeId: 'cdc-oriente', tipo: 'refresco' },
    { secret: 'secreto-de-pruebas-con-mas-de-32-caracteres', expiresIn: '8h' },
  ))).accessToken;

describe('Sesión · el token de refresco no vale como Bearer', () => {
  it('el par emitido lleva cada token marcado con su tipo', async () => {
    const servicio = armar();
    const par = await servicio.refrescar(await jwt.signAsync(
      { sub: 'u1', rol: 'asistente', sedeId: 'cdc-oriente', tipo: 'refresco' },
      { secret: 'secreto-de-pruebas-con-mas-de-32-caracteres', expiresIn: '8h' },
    ));

    expect(leer(par.accessToken).tipo).toBe('acceso');
    expect(leer(par.refreshToken).tipo).toBe('refresco');
  });

  it('un token de ACCESO no sirve para refrescar', async () => {
    const servicio = armar();
    const acceso = await jwt.signAsync(
      { sub: 'u1', rol: 'asistente', sedeId: 'cdc-oriente', tipo: 'acceso' },
      { secret: 'secreto-de-pruebas-con-mas-de-32-caracteres', expiresIn: '1h' },
    );
    await expect(servicio.refrescar(acceso)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un token viejo, sin marca de tipo, tampoco refresca', async () => {
    const servicio = armar();
    const viejo = await jwt.signAsync(
      { sub: 'u1', rol: 'asistente', sedeId: 'cdc-oriente' },
      { secret: 'secreto-de-pruebas-con-mas-de-32-caracteres', expiresIn: '1h' },
    );
    await expect(servicio.refrescar(viejo)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un token ilegible da el mismo error, sin decir qué falló', async () => {
    await expect(armar().refrescar('no-es-un-token')).rejects.toThrow('Sesión expirada');
  });
});

describe('Sesión · quien ya no trabaja aquí no renueva', () => {
  it('un usuario desactivado no puede refrescar, aunque su token siga vigente', async () => {
    const servicio = armar({ ...USUARIO, activo: false });
    await expect(refrescoDe(servicio)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un usuario borrado tampoco', async () => {
    await expect(refrescoDe(armar(null))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('Sesión · las duraciones se editan desde Administración → Reglas', () => {
  const duracion = (token: string) => leer(token).exp - leer(token).iat;

  it('manda la configuración sobre el valor de entorno', async () => {
    const acceso = await refrescoDe(armar(USUARIO, { sesion_ttl_acceso: '2h', sesion_ttl_inactividad: '8h' }));
    expect(duracion(acceso)).toBe(2 * 3600);
  });

  it('un valor mal escrito cae al de entorno en vez de firmar una duración absurda', async () => {
    const acceso = await refrescoDe(armar(USUARIO, { sesion_ttl_acceso: 'dos horas' }));
    expect(duracion(acceso)).toBe(15 * 60); // JWT_ACCESS_TTL
  });

  it('sin claves en configuración, rige el entorno', async () => {
    const acceso = await refrescoDe(armar(USUARIO, {}));
    expect(duracion(acceso)).toBe(15 * 60);
  });
});
