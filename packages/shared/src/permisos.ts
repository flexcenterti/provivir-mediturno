/**
 * Permisos granulares (perfiles).
 *
 * Antes la autorización era un enum de cuatro roles cableado en cada controlador.
 * Servía para arrancar, pero una clínica real tiene matices —una asistente que
 * factura pero no toca agendas, un coordinador que ve métricas y nada más— y cada
 * matiz obligaba a tocar código y desplegar.
 *
 * Ahora un perfil es una lista de permisos, editable desde el backoffice. Esta es
 * la lista cerrada de lo que se puede conceder: el backend la exige en cada ruta y
 * el frontend la pinta como casillas. Vive en el paquete compartido justamente para
 * que no puedan divergir.
 *
 * Al añadir un permiso: declararlo aquí, exigirlo en su ruta con @Permisos() y
 * decidir si entra en alguno de los perfiles base de abajo.
 */

export interface DefinicionPermiso {
  clave: string;
  /** Agrupa las casillas en la pantalla de perfiles. */
  area: string;
  etiqueta: string;
  /** Qué habilita, en términos de lo que la persona hace, no de endpoints. */
  descripcion: string;
}

export const PERMISOS: readonly DefinicionPermiso[] = [
  { clave: 'bandeja.operar', area: 'Atención', etiqueta: 'Bandeja de WhatsApp',
    descripcion: 'Ver y responder las conversaciones que la IA escaló.' },
  { clave: 'mostrador.operar', area: 'Atención', etiqueta: 'Mostrador',
    descripcion: 'Registrar llegadas y llamar turnos a consultorio.' },
  { clave: 'turnos.ver', area: 'Atención', etiqueta: 'Ver la cola del día',
    descripcion: 'Consultar los turnos en espera. Es lo mínimo que necesita una pantalla de sala.' },
  { clave: 'turnos.atender', area: 'Atención', etiqueta: 'Llamar y cerrar turnos',
    descripcion: 'Llamar al siguiente paciente, priorizar y dar por atendido. Lo usan asistentes y médicos.' },

  { clave: 'citas.gestionar', area: 'Citas', etiqueta: 'Agendar y cancelar',
    descripcion: 'Crear, reprogramar y cancelar citas desde el backoffice.' },
  { clave: 'agenda.ver', area: 'Citas', etiqueta: 'Ver agendas',
    descripcion: 'Consultar los horarios de los prestadores.' },
  { clave: 'agenda.editar', area: 'Citas', etiqueta: 'Modificar agendas',
    descripcion: 'Crear, bloquear y cambiar horarios (RN-06.1).' },

  { clave: 'pacientes.ver', area: 'Pacientes', etiqueta: 'Consultar pacientes',
    descripcion: 'Buscar pacientes y ver su historial de servicios.' },
  { clave: 'pacientes.editar', area: 'Pacientes', etiqueta: 'Editar pacientes',
    descripcion: 'Corregir datos de contacto y condiciones.' },
  { clave: 'carga.ejecutar', area: 'Pacientes', etiqueta: 'Carga masiva',
    descripcion: 'Importar archivos de pacientes y contactos. Afecta a toda la base.' },

  { clave: 'catalogo.editar', area: 'Configuración', etiqueta: 'Catálogo',
    descripcion: 'Servicios y prestadores: duraciones, cupos y ventanas de control.' },
  { clave: 'pantallas.ver', area: 'Configuración', etiqueta: 'Ver pantallas',
    descripcion: 'Consultar el estado de las pantallas de sala.' },
  { clave: 'pantallas.editar', area: 'Configuración', etiqueta: 'Configurar pantallas',
    descripcion: 'Cambiar servicios, mensajes y videos de cada pantalla.' },
  { clave: 'configuracion.editar', area: 'Configuración', etiqueta: 'Reglas del sistema',
    descripcion: 'Parámetros de agendamiento y documentación comercial de la IA.' },

  { clave: 'metricas.ver', area: 'Dirección', etiqueta: 'Tablero',
    descripcion: 'Indicadores de ocupación, ausentismo y demanda.' },
  { clave: 'auditoria.ver', area: 'Dirección', etiqueta: 'Auditoría',
    descripcion: 'Quién hizo qué y cuándo. Incluye acciones sobre datos de pacientes.' },
  { clave: 'usuarios.gestionar', area: 'Dirección', etiqueta: 'Usuarios y perfiles',
    descripcion: 'Crear cuentas y decidir qué puede ver cada una. Concede todo lo demás indirectamente.' },
] as const;

export type Permiso = (typeof PERMISOS)[number]['clave'];

export const CLAVES_PERMISO: readonly string[] = PERMISOS.map((p) => p.clave);

export const esPermisoValido = (clave: string): boolean => CLAVES_PERMISO.includes(clave);

/** Las áreas en el orden en que deben pintarse. */
export const AREAS_PERMISO: readonly string[] = [...new Set(PERMISOS.map((p) => p.area))];

/**
 * Perfiles que se crean solos y no se pueden borrar. Reproducen exactamente lo que
 * hacían los cuatro roles anteriores, para que nadie pierda acceso al migrar.
 * Sí se pueden editar: son un punto de partida, no una jaula.
 */
export const PERFILES_BASE = [
  {
    nombre: 'Administración',
    descripcion: 'Acceso completo. Equivale al antiguo rol admin.',
    permisos: CLAVES_PERMISO,
  },
  {
    nombre: 'Asistente',
    descripcion: 'Atención al paciente y agenda del día. Equivale al antiguo rol asistente.',
    permisos: [
      'bandeja.operar', 'mostrador.operar', 'turnos.ver', 'turnos.atender',
      'citas.gestionar', 'agenda.ver', 'agenda.editar',
      'pacientes.ver', 'pantallas.ver', 'metricas.ver',
    ],
  },
  {
    nombre: 'Médico',
    descripcion: 'Su propia agenda y sus pacientes del día. Equivale al antiguo rol prestador.',
    permisos: ['turnos.ver', 'turnos.atender', 'agenda.ver'],
  },
  {
    nombre: 'Pantalla de sala',
    descripcion: 'Solo lectura para los televisores (RN-11). Equivale al antiguo rol pantalla.',
    permisos: ['turnos.ver'],
  },
] as const;
