import { esModoNombre, nombreParaPantalla } from './nombre-en-pantalla';

describe('Nombre del paciente en las pantallas de sala', () => {
  const rosa = ['Rosa María', 'Quintero Vélez'] as const;

  it('completo lo muestra tal cual', () => {
    expect(nombreParaPantalla(...rosa, 'completo')).toBe('Rosa María Quintero Vélez');
  });

  it('abreviado deja lo justo para reconocerse', () => {
    // Basta para que ella sepa que es su turno; no para identificarla desde fuera.
    expect(nombreParaPantalla(...rosa, 'abreviado')).toBe('Rosa Q.');
    expect(nombreParaPantalla('Juan', 'Pérez', 'abreviado')).toBe('Juan P.');
  });

  it('oculto no deja nada: solo queda el código de turno', () => {
    expect(nombreParaPantalla(...rosa, 'oculto')).toBe('');
  });

  it('aguanta nombres incompletos sin dejar puntuación suelta', () => {
    expect(nombreParaPantalla('Madonna', '', 'abreviado')).toBe('Madonna');
    expect(nombreParaPantalla('  Ana  ', '  Ríos  ', 'abreviado')).toBe('Ana R.');
  });

  it('valida el modo que venga de la configuración', () => {
    expect(esModoNombre('abreviado')).toBe(true);
    expect(esModoNombre('lo-que-sea')).toBe(false);
  });
});
