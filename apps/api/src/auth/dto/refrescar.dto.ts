import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefrescarDto {
  /** El token de refresco emitido en el login o en el refresco anterior. */
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  refreshToken!: string;
}
