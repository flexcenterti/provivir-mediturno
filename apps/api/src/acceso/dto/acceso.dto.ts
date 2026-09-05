import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { CLAVES_PERMISO, ROLES, type Rol } from '@provivir/shared';

export class CrearPerfilDto {
  @IsString() @Length(3, 60)
  nombre!: string;

  @IsOptional() @IsString() @Length(0, 200)
  descripcion?: string;

  /** Solo claves declaradas: un permiso inventado no protegería nada. */
  @IsArray() @ArrayUnique() @IsIn(CLAVES_PERMISO as string[], { each: true })
  permisos!: string[];
}

export class ActualizarPerfilDto {
  @IsOptional() @IsString() @Length(3, 60)
  nombre?: string;

  @IsOptional() @IsString() @Length(0, 200)
  descripcion?: string;

  @IsOptional() @IsArray() @ArrayUnique() @IsIn(CLAVES_PERMISO as string[], { each: true })
  permisos?: string[];

  @IsOptional() @IsBoolean()
  activo?: boolean;
}

export class CrearUsuarioDto {
  @IsEmail()
  email!: string;

  @IsString() @Length(3, 80)
  nombre!: string;

  @IsString()
  perfilId!: string;

  /** Sigue definiendo el vínculo con la ficha del prestador (RN-06.2). */
  @IsIn(ROLES as unknown as string[])
  rol!: Rol;

  @IsOptional() @IsString()
  prestadorId?: string;
}

export class ActualizarUsuarioDto {
  @IsOptional() @IsString() @Length(3, 80)
  nombre?: string;

  @IsOptional() @IsString()
  perfilId?: string;

  @IsOptional() @IsBoolean()
  activo?: boolean;

  /** Sigue definiendo el vínculo con la ficha del prestador (RN-06.2). */
  @IsOptional() @IsIn(ROLES as unknown as string[])
  rol?: Rol;

  /**
   * La ficha de prestador. **Ausente y `null` no son lo mismo**: ausente significa
   * «no lo toques» y `null` significa «quítalo». Colapsarlos haría que guardar el
   * nombre de un médico le arrancara la ficha, así que la distinción viaja hasta
   * `resolverVinculo`. `@IsOptional()` deja pasar `null` a propósito.
   */
  @IsOptional() @IsString()
  prestadorId?: string | null;
}
