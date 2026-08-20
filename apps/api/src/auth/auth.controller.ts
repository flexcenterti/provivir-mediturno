import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Publico } from './decorators/publico.decorator';
import { UsuarioActual } from './decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from './auth.types';

/**
 * Los decoradores se evalúan al importar el módulo, antes de que exista el ConfigService,
 * así que este límite se lee de process.env. Sigue siendo configuración de ambiente:
 * estricto por defecto (5/min), ajustable para pruebas de carga y suites e2e.
 */
const LIMITE_LOGIN = Number(process.env.THROTTLE_LOGIN_LIMIT ?? 5);

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Límite estricto por IP para frenar fuerza bruta. */
  @Publico()
  @Throttle({ default: { limit: LIMITE_LOGIN, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('yo')
  yo(@UsuarioActual() usuario: UsuarioAutenticado) {
    return usuario;
  }
}
