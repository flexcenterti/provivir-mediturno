import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { TIPOS_CITA } from '@provivir/shared';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class ConsultarCuposDto {
  @IsString()
  servicioId!: string;

  @IsString() @Matches(FECHA, { message: 'Fecha inválida (AAAA-MM-DD)' })
  fecha!: string;

  /** Sin prestador, en medicina general se aplica balanceo (RN-02.2). */
  @IsOptional() @IsString()
  prestadorId?: string;

  /** Para citas de control: la consulta origen determina la ventana (RN-01.3). */
  @IsOptional() @IsString()
  citaOrigenId?: string;

  @IsOptional() @IsIn(TIPOS_CITA as unknown as string[])
  tipo?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limite?: number;
}

export class CrearCitaDto {
  @IsString()
  pacienteId!: string;

  @IsString()
  servicioId!: string;

  @IsString() @Matches(FECHA)
  fecha!: string;

  @IsString() @Matches(HORA)
  hora!: string;

  /** Si no se indica, el motor lo elige por balanceo en medicina general (RN-02). */
  @IsOptional() @IsString()
  prestadorId?: string;

  @IsOptional() @IsIn(TIPOS_CITA as unknown as string[])
  tipo?: string;

  /** RN-01.3 · obligatorio cuando tipo=control. */
  @IsOptional() @IsString()
  citaOrigenId?: string;

  @IsOptional() @IsIn(['mostrador', 'whatsapp', 'autoagendamiento', 'asistente'])
  origen?: string;

  @IsOptional() @IsString() @MaxLength(300)
  observacion?: string;
}

export class ReprogramarCitaDto {
  @IsString() @Matches(FECHA)
  fecha!: string;

  @IsString() @Matches(HORA)
  hora!: string;

  @IsOptional() @IsString()
  prestadorId?: string;

  @IsOptional() @IsString() @MaxLength(300)
  motivo?: string;

  /**
   * Si se le avisa al paciente por WhatsApp. Por defecto sí; cuando la asistente
   * decide que no, queda en auditoría que fue decisión suya.
   */
  @IsOptional() @IsBoolean()
  notificar?: boolean;
}

export class CancelarCitaDto {
  @IsString() @MaxLength(300)
  motivo!: string;

  @IsOptional() @IsBoolean()
  notificar?: boolean;
}
