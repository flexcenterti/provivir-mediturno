export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'asistente' | 'prestador' | 'pantalla';
  prestadorId: string | null;
}

export interface RespuestaLogin {
  accessToken: string;
  refreshToken: string;
  usuario: UsuarioSesion;
}

export async function login(email: string, password: string): Promise<RespuestaLogin> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    // El backend devuelve un mensaje genérico a propósito: sin enumeración de cuentas.
    throw new Error(r.status === 401 ? 'Credenciales inválidas' : 'No fue posible iniciar sesión');
  }
  return r.json();
}
