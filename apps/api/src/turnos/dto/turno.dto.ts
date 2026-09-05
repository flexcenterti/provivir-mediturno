import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { COBROS, PRIORIDADES, type Cobro } from '@provivir/shared';

export class RegistrarLlegadaDto {
  /** Se identifica por código de atención o por documento (Especificación §2.10). */
  @IsOptional() @IsString() @MaxLength(12)
  codigo?: string;

  @IsOptional() @IsString() @MaxLength(20)
  documento?: string;

  @IsOptional() @IsString() @MaxLength(60)
  consultorio?: string;

  /**
   * RN-07.6 · Qué se hizo con el cobro. **Obligatorio**: hasta ahora la auditoría
   * afirmaba «pago en recepción» en toda llegada, hubiera pagado o no.
   *
   * Solo dos desenlaces. Si el paciente no paga, no se llama a esto: se cancela o se
   * reprograma la cita, y la ausencia de turno es la constancia.
   */
  @IsIn(COBROS as unknown as string[])
  cobro!: Cobro;

  /**
   * Obligatoria cuando el desenlace contradice la política del servicio. No se puede
   * exigir desde aquí: el DTO no conoce el servicio, y pedirle la política al cliente
   * dejaría que el cliente mintiera para saltarse la nota. La exige el servicio.
   */
  @IsOptional() @IsString() @MinLength(5) @MaxLength(300)
  cobroNota?: string;
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
