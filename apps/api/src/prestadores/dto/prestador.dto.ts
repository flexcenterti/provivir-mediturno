import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

export class DuracionServicioDto {
  @IsString()
  servicioId!: string;

  /** RN-01.4 · duración por prestador y tipo. */
  @Type(() => Number) @IsInt() @Min(5) @Max(480)
  duracionMin!: number;
}

export class CrearPrestadorDto {
  @IsString() @MinLength(2) @MaxLength(60)
  id!: string;

  @IsString() @MinLength(3) @MaxLength(120)
  nombre!: string;

  @IsString() @MaxLength(80)
  especialidad!: string;

  /** RN-02.1 · true solo para medicina general: es el único grupo que balancea. */
  @IsOptional() @IsBoolean()
  grupoBalanceo?: boolean;

  @IsOptional() @IsString() @MaxLength(20)
  vinculacion?: string;

  @IsOptional() @IsString() @MaxLength(60)
  consultorio?: string;

  /** RN-01.3 · días máximos entre la consulta origen y el control. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  ventanaControlDias?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DuracionServicioDto)
  duraciones?: DuracionServicioDto[];
}

export class ActualizarPrestadorDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(80)
  especialidad?: string;

  @IsOptional() @IsBoolean()
  grupoBalanceo?: boolean;

  @IsOptional() @IsString() @MaxLength(60)
  consultorio?: string;

  @IsOptional() @IsBoolean()
  activo?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  ventanaControlDias?: number;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DuracionServicioDto)
  duraciones?: DuracionServicioDto[];
}
