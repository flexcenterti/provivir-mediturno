import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
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

  // ── Ficha comercial (RN-04.5.1) · es lo que el bot usa para vender.
  // Sin descripción ni beneficios el servicio no se ofrece por WhatsApp ni por el
  // portal: el bot no puede venderlo si no sabe qué decir de él.

  @IsOptional() @IsString() @MaxLength(600)
  descripcionComercial?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(200, { each: true })
  beneficios?: string[];

  @IsOptional() @IsString() @MaxLength(600)
  preparacion?: string;

  @IsOptional() @IsString() @MaxLength(300)
  enlaceInfo?: string;

  @IsOptional() @IsString() @MaxLength(80)
  rangoPrecio?: string;

  /** RN-13.9 · Si es false, el bot lo describe pero no ofrece agendarlo por chat. */
  @IsOptional() @IsBoolean()
  agendable?: boolean;
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

  // ── Ficha comercial (RN-04.5.1) · es lo que el bot usa para vender.
  // Sin descripción ni beneficios el servicio no se ofrece por WhatsApp ni por el
  // portal: el bot no puede venderlo si no sabe qué decir de él.

  @IsOptional() @IsString() @MaxLength(600)
  descripcionComercial?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(200, { each: true })
  beneficios?: string[];

  @IsOptional() @IsString() @MaxLength(600)
  preparacion?: string;

  @IsOptional() @IsString() @MaxLength(300)
  enlaceInfo?: string;

  @IsOptional() @IsString() @MaxLength(80)
  rangoPrecio?: string;

  /** RN-13.9 · Si es false, el bot lo describe pero no ofrece agendarlo por chat. */
  @IsOptional() @IsBoolean()
  agendable?: boolean;

  /**
   * RN-04.5.3 · Pasar a false desactiva el servicio y dispara los efectos en cadena
   * (cancelar seguimientos, marcar artículos para revisión). Se acepta aquí y no solo
   * en el endpoint dedicado para que la cascada ocurra venga por donde venga.
   */
  @IsOptional() @IsBoolean()
  activo?: boolean;
}
