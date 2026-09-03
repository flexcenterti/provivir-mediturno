import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** RN-06.5 · cerrar un día concreto de la sede. */
export class CrearDiaNoLaborableDto {
  @IsString() @Matches(FECHA, { message: 'Fecha inválida (AAAA-MM-DD)' })
  fecha!: string;

  @IsString() @MaxLength(120)
  motivo!: string;

  /** Por defecto `cierre`: los festivos entran por la importación, no a mano. */
  @IsOptional() @IsIn(['festivo', 'cierre'])
  tipo?: 'festivo' | 'cierre';

  /** Sin confirmar solo se devuelve el impacto, igual que al bloquear una agenda. */
  @IsOptional() @IsBoolean()
  confirmar?: boolean;
}

export class ImportarFestivosDto {
  @Type(() => Number) @IsInt() @Min(2020) @Max(2100)
  anio!: number;
}
