import { PERFILES_BASE, PERMISOS, CLAVES_PERMISO } from '@provivir/shared';
import { permisosDe } from './permisos.resolucion';

describe('Catálogo de permisos', () => {
  it('no tiene claves repetidas', () => {
    expect(new Set(CLAVES_PERMISO).size).toBe(CLAVES_PERMISO.length);
  });

  it('cada permiso se explica en términos de lo que la persona hace', () => {
    for (const p of PERMISOS) {
      expect(p.clave).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(p.etiqueta.length).toBeGreaterThan(3);
      expect(p.descripcion.length).toBeGreaterThan(20);
    }
  });

  it('los perfiles base solo conceden permisos que existen', () => {
    for (const perfil of PERFILES_BASE) {
      for (const clave of perfil.permisos) expect(CLAVES_PERMISO).toContain(clave);
    }
  });

  it('exactamente un perfil base puede gestionar usuarios', () => {
    // Si fueran dos, repartir el permiso más peligroso sería el estado por defecto.
    const conGestion = PERFILES_BASE.filter((p) => (p.permisos as readonly string[]).includes('usuarios.gestionar'));
    expect(conGestion.map((p) => p.nombre)).toEqual(['Administración']);
  });

  it('la pantalla de sala no ve nada más que la cola', () => {
    // Es un televisor colgado en una sala de espera: cualquier permiso de más ahí
    // queda expuesto a quien pase por delante.
    const pantalla = PERFILES_BASE.find((p) => p.nombre === 'Pantalla de sala')!;
    expect([...pantalla.permisos]).toEqual(['turnos.ver']);
  });
});

describe('Resolución de permisos de un usuario', () => {
  it('manda el perfil cuando lo tiene', () => {
    expect(permisosDe({ rol: 'pantalla', perfil: { permisos: ['metricas.ver'], activo: true } }))
      .toEqual(['metricas.ver']);
  });

  it('un perfil desactivado no concede nada', () => {
    // Así se corta el acceso de un grupo entero sin tocar usuario por usuario.
    expect(permisosDe({ rol: 'admin', perfil: { permisos: CLAVES_PERMISO as string[], activo: false } }))
      .toEqual([]);
  });

  it('sin perfil se cae al equivalente de su rol, para que nadie pierda el acceso', () => {
    // Los usuarios creados antes de que existieran los perfiles siguen entrando.
    expect(permisosDe({ rol: 'admin', perfil: null })).toContain('usuarios.gestionar');
    expect(permisosDe({ rol: 'prestador', perfil: null })).toEqual(['turnos.ver', 'turnos.atender', 'agenda.ver']);
    expect(permisosDe({ rol: 'pantalla', perfil: null })).toEqual(['turnos.ver']);
  });
});
