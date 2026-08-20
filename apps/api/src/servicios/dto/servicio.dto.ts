import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { TIPOS_CITA } from '@provivir/shared';

const POLITICAS_COSTO = ['sin_costo', 'costo_pleno', 'porcentaje'] as const;

export class CrearServicioDto {
  @IsString() @MinLength(2) @MaxLength(40)
  id!: string;

  @IsString() @MinLength(3) @MaxLength(120)
  nombre!: string;

  @IsString() @MaxLength(60)
  categoria!: string;

  @IsIn(TIPOS_CITA as unknown as string[])
  tipo!: string;

  @Type(() => Number) @IsInt() @Min(5) @Max(480)
  duracionMin!: number;

  /** RN-04.4 · slots que ocupa el servicio (Doppler = 2). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8)
  cupos?: number;

  @IsOptional() @IsBoolean()
  requiereOrden?: boolean;

  /** RN-01.2 · el control no tiene costo; parametrizable a futuro. */
  @IsOptional() @IsIn(POLITICAS_COSTO as unknown as string[])
  politicaCosto?: string;
}

export class ActualizarServicioDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120)
  nombre?: string;

  @IsOptional() @IsString() @MaxLength(60)
  categoria?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(480)
  duracionMin?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(8)
  cupos?: number;

  @IsOptional() @IsBoolean()
  requiereOrden?: boolean;

  @IsOptional() @IsIn(POLITICAS_COSTO as unknown as string[])
  politicaCosto?: string;

  @IsOptional() @IsBoolean()
  activo?: boolean;
}
