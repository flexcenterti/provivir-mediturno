import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginacionDto } from '../../comun/paginacion';

export const VISTAS_BANDEJA = ['pendientes', 'cerradas', 'todas'] as const;
export type VistaBandeja = (typeof VISTAS_BANDEJA)[number];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Filtros de la bandeja.
 *
 * `vista` es un discriminador de negocio, NO el enum `EstadoConversacion`:
 * "pendientes" no es un estado, es «sin resolver y esperando a una persona» —
 * incluye `escalada` y `en_gestion`, y también una reabierta que el bot había
 * resuelto solo.
 *
 * Sin ningún parámetro devuelve exactamente lo que devolvía antes: los pendientes,
 * en el mismo orden.
 */
export class BuscarBandejaDto extends PaginacionDto {
  @IsOptional() @IsIn(VISTAS_BANDEJA)
  vista: VistaBandeja = 'pendientes';

  /** Teléfono, nombre o documento del paciente. */
  @IsOptional() @IsString() @MinLength(3) @MaxLength(80)
  q?: string;

  @IsOptional() @Matches(FECHA, { message: 'desde debe ser AAAA-MM-DD' })
  desde?: string;

  @IsOptional() @Matches(FECHA, { message: 'hasta debe ser AAAA-MM-DD' })
  hasta?: string;

  /**
   * Los pendientes se ven enteros, que es como la asistente los ha visto siempre:
   * son decenas y esconder el número 26 detrás de un paginador sería una regresión.
   * El histórico sí se pagina de verdad.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  override porPagina: number = 100;
}

/**
 * Abrir conversación con un paciente desde el backoffice.
 *
 * La llave es el PACIENTE y no la cita: una conversación es de un número, no de una
 * cita. `citaId` solo enriquece el motivo y la auditoría, para que en la bandeja se
 * lea por qué se le escribió.
 */
export class AbrirConversacionDto {
  @IsString() @IsUUID()
  pacienteId!: string;

  @IsOptional() @IsString() @IsUUID()
  citaId?: string;
}
