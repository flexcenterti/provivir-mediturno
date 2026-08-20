import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PRIORIDADES } from '@provivir/shared';

export class RegistrarLlegadaDto {
  /** Se identifica por código de atención o por documento (Especificación §2.10). */
  @IsOptional() @IsString() @MaxLength(12)
  codigo?: string;

  @IsOptional() @IsString() @MaxLength(20)
  documento?: string;

  @IsOptional() @IsString() @MaxLength(60)
  consultorio?: string;
}

/**
 * RN-07.4 · Priorización por el prestador: exige nota del motivo.
 * El sistema reordena la cola y queda auditado.
 */
export class PriorizarTurnoDto {
  @IsIn(PRIORIDADES as unknown as string[])
  prioridad!: string;

  @IsString() @MinLength(5, { message: 'La nota del motivo es obligatoria (RN-07.4)' }) @MaxLength(300)
  nota!: string;
}

export class LlamarSiguienteDto {
  @IsString()
  prestadorId!: string;

  @IsOptional() @IsString() @MaxLength(60)
  consultorio?: string;
}
