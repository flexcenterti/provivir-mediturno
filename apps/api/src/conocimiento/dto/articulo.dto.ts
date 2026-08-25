import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const ESTADOS = ['borrador', 'publicado', 'archivado'] as const;

export class CrearArticuloDto {
  @IsString() @MinLength(3) @MaxLength(160)
  titulo!: string;

  @IsString() @MinLength(2) @MaxLength(60)
  categoria!: string;

  /** Markdown. Se trocea por encabezados al publicar (RN-13). */
  @IsString() @MaxLength(60_000)
  contenidoMd!: string;

  /** Vincula con el catálogo. Las cifras salen del servicio, no del texto (RN-13.1). */
  @IsOptional() @IsString() @MaxLength(40)
  servicioId?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];

  @IsOptional() @IsDateString()
  vigenteHasta?: string;
}

export class ActualizarArticuloDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160)
  titulo?: string;

  @IsOptional() @IsString() @MinLength(2) @MaxLength(60)
  categoria?: string;

  @IsOptional() @IsString() @MaxLength(60_000)
  contenidoMd?: string;

  /**
   * `null` explícito desvincula el servicio. Sin esta distinción no había forma
   * de deshacer un vínculo equivocado: omitir el campo significa «no lo toques»
   * y cualquier cadena significa «átalo a este», así que faltaba «suéltalo».
   */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40)
  servicioId?: string | null;

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];

  /** `null` limpia la fecha de vigencia; ver el comentario de `servicioId`. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString()
  vigenteHasta?: string | null;
}

/** Ventana del KPI de resolución sin humano. */
export class ResumenConocimientoDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365)
  dias?: number;
}

/** Filtros del listado. El estado no se valida como enum de Prisma para no filtrar su tipo al DTO. */
export class ListarArticulosDto {
  @IsOptional() @IsIn(ESTADOS as unknown as string[])
  estado?: string;

  @IsOptional() @IsString() @MaxLength(40)
  servicioId?: string;
}

/**
 * Probador del backoffice: permite ensayar una pregunta y ver qué recupera,
 * antes de que un paciente la haga (RN-13, criterio de aceptación 16).
 */
export class ProbarPreguntaDto {
  @IsString() @MinLength(2) @MaxLength(500)
  pregunta!: string;

  @IsOptional() @IsString() @MaxLength(40)
  servicioId?: string;

  /** Por defecto no registra: ensayar no debe ensuciar métricas ni la cola de mejora. */
  @IsOptional() @Type(() => Boolean)
  registrar?: boolean;
}
