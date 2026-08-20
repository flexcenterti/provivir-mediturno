import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** La clínica maneja 400k pacientes: ningún listado se sirve completo. */
export class PaginacionDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  pagina: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  porPagina: number = 25;

  get salto(): number {
    return (this.pagina - 1) * this.porPagina;
  }
}

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

export function armarPagina<T>(datos: T[], total: number, p: PaginacionDto): Pagina<T> {
  return {
    datos,
    total,
    pagina: p.pagina,
    porPagina: p.porPagina,
    paginas: Math.ceil(total / p.porPagina) || 1,
  };
}
