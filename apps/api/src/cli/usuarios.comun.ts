import { randomBytes } from 'node:crypto';
import type { PrismaClient, Rol } from '@prisma/client';
import { hashearPassword } from '../auth/argon2.opciones';

export const ROLES: readonly Rol[] = ['admin', 'asistente', 'prestador', 'pantalla'];

/** Qué ve cada perfil. Se imprime al crear, para que nadie tenga que adivinarlo. */
export const QUE_HACE: Record<Rol, string> = {
  admin: 'Todo: catálogo, agendas, reglas, auditoría y usuarios.',
  asistente: 'Bandeja de WhatsApp, mostrador, agenda del día y pacientes.',
  prestador: 'Solo su propia agenda y sus pacientes del día.',
  pantalla: 'Únicamente el estado de las pantallas de sala.',
};

/**
 * Contraseña generada, no elegida. Se excluyen los caracteres que se confunden al
 * dictarla por teléfono (O/0, l/1/I) porque alguien la va a dictar.
 */
export function generarPassword(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const simbolos = '!@#$%&*?';
  const tomar = (fuente: string, n: number) =>
    Array.from(randomBytes(n)).map((b) => fuente[b % fuente.length]).join('');
  // Se baraja para que los símbolos no queden siempre al final.
  const bruto = (tomar(alfabeto, 18) + tomar(simbolos, 3)).split('');
  for (let i = bruto.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [bruto[i], bruto[j]] = [bruto[j]!, bruto[i]!];
  }
  return bruto.join('');
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
      hashPassword, sedeId: alta.sedeId,
    },
  });
  return { estado: 'creado', email, rol: alta.rol, password };
}
