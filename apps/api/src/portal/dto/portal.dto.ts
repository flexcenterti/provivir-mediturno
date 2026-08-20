import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * RN-10.2 · "Paciente registrado": documento → validación.
 *
 * Se exige además los últimos 4 dígitos del teléfono. El portal es público y sin
 * login: con solo el documento, cualquiera podría averiguar quién es paciente de la
 * clínica probando cédulas — el checklist §4 lo prohíbe explícitamente
 * ("sin enumeración de pacientes"). Los cuatro dígitos convierten la consulta en
 * una verificación y no en un oráculo.
 */
export class IdentificarDto {
  @IsString() @Matches(/^[0-9A-Za-z-]{4,20}$/, { message: 'Documento inválido' })
  documento!: string;

  @IsString() @Matches(/^\d{4}$/, { message: 'Indique los últimos 4 dígitos de su teléfono' })
  telefonoUltimos4!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  captcha?: string;
}

export class RegistrarPacienteDto {
  @IsString() @Matches(/^[0-9A-Za-z-]{4,20}$/, { message: 'Documento inválido' })
  documento!: string;

  @IsString() @MinLength(2) @MaxLength(80)
  nombres!: string;

  @IsString() @MinLength(2) @MaxLength(80)
  apellidos!: string;

  @IsString() @Matches(/^[+\d][\d\s-]{6,24}$/, { message: 'Teléfono inválido' })
  telefono!: string;

  @IsOptional() @IsEmail() @MaxLength(160)
  correo?: string;

  /** Ley 1581/2012 · el paciente debe aceptar el tratamiento de sus datos. */
  @IsString() @Matches(/^si$/i, { message: 'Debe aceptar el aviso de privacidad para continuar' })
  aceptaPrivacidad!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  captcha?: string;
}

export class CuposPortalDto {
  @IsString()
  servicioId!: string;

  @IsString() @Matches(FECHA, { message: 'Fecha inválida (AAAA-MM-DD)' })
  fecha!: string;

  @IsOptional() @IsString()
  prestadorId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  limite?: number;
}

export class AgendarDto {
  /** Token de sesión efímero que devuelve identificar/registrar. */
  @IsString() @MaxLength(300)
  sesion!: string;

  @IsString()
  servicioId!: string;

  @IsString() @Matches(FECHA)
  fecha!: string;

  @IsString() @Matches(HORA)
  hora!: string;

  @IsString()
  prestadorId!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  captcha?: string;
}
