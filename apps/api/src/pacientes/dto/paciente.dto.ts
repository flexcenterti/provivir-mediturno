import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength,
} from 'class-validator';
import { MARCAS_PREFERENCIALES, ORIGENES_PACIENTE } from '@provivir/shared';
import { PaginacionDto } from '../../comun/paginacion';

const TIPOS_DOC = ['CC', 'TI', 'CE', 'PA', 'RC', 'NIT'] as const;

export class CrearPacienteDto {
  @IsIn(TIPOS_DOC)
  tdoc: string = 'CC';

  /** Identificador principal para deduplicación (RN-12.5). */
  @IsString() @Matches(/^[0-9A-Za-z-]{4,20}$/, { message: 'Documento inválido' })
  documento!: string;

  @IsString() @MinLength(2) @MaxLength(80)
  nombres!: string;

  @IsString() @MinLength(2) @MaxLength(80)
  apellidos!: string;

  @IsOptional() @IsString() @MaxLength(25)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(25)
  whatsapp?: string;

  /** El cliente casi no maneja correo: opcional a propósito (Especificación §2.2). */
  @IsOptional() @IsEmail() @MaxLength(160)
  correo?: string;

  @IsOptional() @IsString()
  fechaNac?: string;

  @IsOptional() @IsIn(['M', 'F', 'O'])
  sexo?: string;

  /** Marcas preferenciales para la cola de atención (RN-05.2). */
  @IsOptional() @IsArray() @ArrayMaxSize(5)
  @IsIn(MARCAS_PREFERENCIALES as unknown as string[], { each: true })
  condiciones?: string[];

  @IsOptional() @IsIn(ORIGENES_PACIENTE as unknown as string[])
  origen?: string;
}

export class ActualizarPacienteDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  nombres?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(80)
  apellidos?: string;

  @IsOptional() @IsString() @MaxLength(25)
  telefono?: string;

  @IsOptional() @IsString() @MaxLength(25)
  whatsapp?: string;

  @IsOptional() @IsEmail() @MaxLength(160)
  correo?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(5)
  @IsIn(MARCAS_PREFERENCIALES as unknown as string[], { each: true })
  condiciones?: string[];
}

export class BuscarPacientesDto extends PaginacionDto {
  /** Busca por documento, apellidos+nombres o teléfono — los tres tienen índice. */
  @IsOptional() @IsString() @MaxLength(80)
  @Type(() => String)
  q?: string;
}
