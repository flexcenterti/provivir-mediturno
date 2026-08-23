import { ConfiguracionService } from './configuracion.service';
import { CONFIGURACION_BASE } from '../cli/configuracion.base';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Un parámetro nuevo que solo se crea en el alta inicial no llega nunca a una
 * instalación ya desplegada: la función se despliega y nadie puede configurarla
 * porque su clave no aparece en Administración → Reglas.
 */
describe('Configuración · los parámetros nuevos llegan a instalaciones ya desplegadas', () => {
  const prismaFalso = () => ({
    configuracion: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
  });

  it('al arrancar inserta las claves base que falten, sin pisar las existentes', async () => {
    const prisma = prismaFalso();
    const servicio = new ConfiguracionService(prisma as unknown as PrismaService);

    await servicio.onModuleInit();

    expect(prisma.configuracion.createMany).toHaveBeenCalledTimes(CONFIGURACION_BASE.length);
    for (const llamada of prisma.configuracion.createMany.mock.calls) {
      // skipDuplicates: lo ya ajustado desde el backoffice es una decisión operativa.
      expect(llamada[0]).toMatchObject({ skipDuplicates: true });
    }
  });

  it('las plantillas de WhatsApp están entre los parámetros base (RN-05, RN-10.3)', () => {
    const claves = CONFIGURACION_BASE.map((c) => c.clave);
    expect(claves).toEqual(expect.arrayContaining([
      'plantilla_recordatorio_24h', 'plantilla_recordatorio_hoy', 'plantilla_confirmacion_cita',
    ]));
  });

  it('un fallo de base no tumba el arranque: se degrada a los valores por defecto', async () => {
    const prisma = prismaFalso();
    prisma.configuracion.createMany.mockRejectedValue(new Error('sin conexión'));
    const servicio = new ConfiguracionService(prisma as unknown as PrismaService);

    await expect(servicio.onModuleInit()).resolves.toBeUndefined();
    expect(servicio.disponible).toBe(false);
  });
});
