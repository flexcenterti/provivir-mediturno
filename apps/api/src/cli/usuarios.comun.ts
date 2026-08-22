import { PERFILES_BASE } from '@provivir/shared';
import type { PrismaClient, Rol } from '@prisma/client';
import { hashearPassword } from '../auth/argon2.opciones';
import { generarPassword } from '../auth/password';

export { generarPassword };

export const ROLES: readonly Rol[] = ['admin', 'asistente', 'prestador', 'pantalla'];

/** Qué ve cada perfil. Se imprime al crear, para que nadie tenga que adivinarlo. */
export const QUE_HACE: Record<Rol, string> = {
  admin: 'Todo: catálogo, agendas, reglas, auditoría y usuarios.',
  asistente: 'Bandeja de WhatsApp, mostrador, agenda del día y pacientes.',
  prestador: 'Solo su propia agenda y sus pacientes del día.',
  pantalla: 'Únicamente el estado de las pantallas de sala.',
};

/** Qué perfil base corresponde a cada rol. */
export const PERFIL_DE_ROL: Record<Rol, string> = {
  admin: 'Administración',
  asistente: 'Asistente',
  prestador: 'Médico',
  pantalla: 'Pantalla de sala',
};

/**
 * Crea los perfiles base si faltan. Idempotente, y NO pisa sus permisos: puede que
 * ya los hayan ajustado desde el backoffice.
 */
export async function asegurarPerfilesBase(prisma: PrismaClient, sedeId: string): Promise<void> {
  for (const base of PERFILES_BASE) {
    await prisma.perfil.upsert({
      where: { nombre: base.nombre },
      update: { sistema: true },
      create: {
        nombre: base.nombre, descripcion: base.descripcion,
        permisos: [...base.permisos], sistema: true, sedeId,
      },
    });
  }
}

export interface AltaUsuario {
  email: string;
  nombre: string;
  rol: Rol;
  sedeId: string;
  prestadorId?: string | null;
  /** Sin esto, un usuario que ya existe no se toca. */
  recrearClave?: boolean;
}

export type ResultadoAlta =
  | { estado: 'creado' | 'clave-nueva'; email: string; rol: Rol; password: string }
  | { estado: 'ya-existe'; email: string; rol: Rol };

/**
 * Da de alta un usuario, o le cambia la contraseña si se pide expresamente.
 *
 * La contraseña se devuelve UNA vez y no se guarda en ningún sitio: en la base solo
 * queda su hash Argon2id, con los mismos parámetros que usa el login.
 */
export async function crearUsuario(prisma: PrismaClient, alta: AltaUsuario): Promise<ResultadoAlta> {
  const email = alta.email.trim().toLowerCase();
  const existente = await prisma.usuario.findUnique({ where: { email } });

  if (existente && !alta.recrearClave) {
    return { estado: 'ya-existe', email, rol: existente.rol };
  }

  if (alta.rol === 'prestador') {
    if (!alta.prestadorId) throw new Error('Un usuario con rol=prestador necesita un prestador asociado (RN-06.2).');
    if (!(await prisma.prestador.findUnique({ where: { id: alta.prestadorId } }))) {
      throw new Error(`No existe el prestador "${alta.prestadorId}".`);
    }
  }

  // Todo usuario nace con un perfil: sin él la autorización caería al equivalente
  // de su rol, que es una red de seguridad, no el camino normal.
  await asegurarPerfilesBase(prisma, alta.sedeId);
  const perfil = await prisma.perfil.findUnique({ where: { nombre: PERFIL_DE_ROL[alta.rol] } });

  const password = generarPassword();
  const hashPassword = await hashearPassword(password);

  if (existente) {
    await prisma.usuario.update({ where: { email }, data: { hashPassword, activo: true } });
    return { estado: 'clave-nueva', email, rol: existente.rol, password };
  }

  await prisma.usuario.create({
    data: {
      email, nombre: alta.nombre, rol: alta.rol,
      prestadorId: alta.prestadorId ?? null,
      perfilId: perfil?.id ?? null,
      hashPassword, sedeId: alta.sedeId,
    },
  });
  return { estado: 'creado', email, rol: alta.rol, password };
}
