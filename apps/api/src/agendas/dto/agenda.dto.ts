import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString,
  Matches, Max, MaxLength, Min,
} from 'class-validator';

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export class CrearAgendaDto {
  @IsString()
  prestadorId!: string;

  /** RN-06.4 · semanal recurrente o por calendario (fechas puntuales). */
  @IsIn(['semanal', 'calendario'])
  modo!: 'semanal' | 'calendario';

  /** modo=semanal · 1=lunes … 7=domingo */
  @IsOptional() @IsArray() @ArrayMaxSize(7)
  @Type(() => Number) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  diasSemana?: number[];

  /** modo=calendario */
  @IsOptional() @IsString() @Matches(FECHA, { message: 'Fecha inválida (AAAA-MM-DD)' })
  fecha?: string;

  @IsString() @Matches(HORA, { message: 'Hora de inicio inválida (HH:MM)' })
  horaIni!: string;

  @IsString() @Matches(HORA, { message: 'Hora de fin inválida (HH:MM)' })
  horaFin!: string;

  @Type(() => Number) @IsInt() @Min(5) @Max(240)
  slotMin!: number;

  @IsOptional() @IsString()
  servicioId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  consultorio?: string;
}

/**
 * RN-06.4 · programación masiva mensual: administración marca varios días del mes
 * y les asigna una franja en un solo paso.
 */
export class ProgramacionMensualDto {
  @IsString()
  prestadorId!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(31)
  @IsString({ each: true }) @Matches(FECHA, { each: true, message: 'Fecha inválida (AAAA-MM-DD)' })
  fechas!: string[];

  @IsString() @Matches(HORA)
  horaIni!: string;

  @IsString() @Matches(HORA)
  horaFin!: string;

  @Type(() => Number) @IsInt() @Min(5) @Max(240)
  slotMin!: number;

  @IsOptional() @IsString()
  servicioId?: string;

  @IsOptional() @IsString() @MaxLength(60)
  consultorio?: string;

  /** Si ya existe agenda de calendario para esa fecha, la reemplaza. */
  @IsOptional() @IsBoolean()
  reemplazar?: boolean;
}

/**
 * RN-06.6 · Parche de una franja.
 *
 * **`prestadorId` NO está aquí a propósito.** Mover una franja a otro médico no es
 * editarla: es retirar una y crear otra, y con otro impacto sobre las citas. Como el
 * pipe global lleva `forbidNonWhitelisted`, mandarlo devuelve 400 sin escribir una sola
 * validación.
 */
export class ActualizarAgendaDto {
  @IsOptional() @IsIn(['semanal', 'calendario']) modo?: 'semanal' | 'calendario';

  @IsOptional() @IsArray() @ArrayMaxSize(7)
  @Type(() => Number) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  diasSemana?: number[];

  @IsOptional() @IsString() @Matches(FECHA, { message: 'Fecha inválida (AAAA-MM-DD)' })
  fecha?: string;

  @IsOptional() @IsString() @Matches(HORA, { message: 'Hora de inicio inválida (HH:MM)' }) horaIni?: string;
  @IsOptional() @IsString() @Matches(HORA, { message: 'Hora de fin inválida (HH:MM)' }) horaFin?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(240) slotMin?: number;
  @IsOptional() @IsString() servicioId?: string;
  @IsOptional() @IsString() @MaxLength(60) consultorio?: string;

  /** Sin él se devuelve el impacto y no se toca nada. Igual que en el bloqueo. */
  @IsOptional() @IsBoolean() confirmar?: boolean;
}

export class RetirarAgendaDto {
  @IsOptional() @IsBoolean() confirmar?: boolean;
}

export class BloquearAgendaDto {
  @IsString() @MaxLength(300)
  motivo!: string;

  /**
   * RN-06.3 · con `confirmar: false` solo devuelve las citas que se verían afectadas,
   * para que administración vea el impacto antes de ejecutar.
   */
  @IsOptional() @IsBoolean()
  confirmar?: boolean;
}
