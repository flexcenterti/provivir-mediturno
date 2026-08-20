import {
  BadRequestException, Body, Controller, Get, Ip, Post, Query, Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { toBuffer } from 'qrcode';
import type { Response } from 'express';
import { PortalService } from './portal.service';
import { CaptchaService } from './captcha.service';
import { AgendarDto, CuposPortalDto, IdentificarDto, RegistrarPacienteDto } from './dto/portal.dto';
import { Publico } from '../auth/decorators/publico.decorator';

/**
 * Portal público de autoagendamiento (D4 / RN-10).
 *
 * Toda la superficie es pública, así que va con rate limiting agresivo y CAPTCHA.
 * Es, junto con el webhook de Meta, lo único expuesto sin login (Arquitectura §8).
 */
@Controller('portal')
@Publico()
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly captcha: CaptchaService,
    private readonly config: ConfigService,
  ) {}

  /** Aviso de privacidad Ley 1581/2012, visible antes de capturar datos. */
  @Get('aviso-privacidad')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  aviso() {
    return {
      responsable: 'Grupo Provivir · CDC Oriente',
      finalidad:
        'Gestionar la asignación, confirmación y recordatorio de citas médicas. ' +
        'No se almacenan datos clínicos: diagnósticos, resultados ni notas médicas.',
      derechos:
        'Puedes conocer, actualizar, rectificar y solicitar la supresión de tus datos ' +
        'escribiendo al WhatsApp de la sede o acercándote a recepción.',
      base: 'Ley 1581 de 2012 y Decreto 1377 de 2013 (Colombia).',
      captchaActivo: this.captcha.activo,
    };
  }

  @Get('servicios')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  servicios() {
    return this.portal.servicios();
  }

  /** Límite estricto: identificarse es la superficie que permitiría enumerar documentos. */
  @Post('identificar')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async identificar(@Body() dto: IdentificarDto, @Ip() ip: string) {
    await this.exigirCaptcha(dto.captcha, ip);
    return this.portal.identificar(dto);
  }

  @Post('registrar')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async registrar(@Body() dto: RegistrarPacienteDto, @Ip() ip: string) {
    await this.exigirCaptcha(dto.captcha, ip);
    return this.portal.registrar(dto);
  }

  @Post('cupos')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  cupos(@Body() dto: CuposPortalDto) {
    return this.portal.cupos(dto);
  }

  @Post('agendar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async agendar(@Body() dto: AgendarDto, @Ip() ip: string) {
    await this.exigirCaptcha(dto.captcha, ip);
    return this.portal.agendar(dto);
  }

  /**
   * RN-10.1 · QR para imprimir en sede y embeber en grupoprovivir.com.
   * Caso de uso: el paciente en la cola lo escanea, agenda desde su celular y se retira.
   */
  @Get('qr.png')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async qr(@Res() res: Response, @Query('tamano') tamano?: string) {
    const url = this.config.get<string>('PORTAL_URL') ?? 'http://localhost:5174';
    const ancho = Math.min(1200, Math.max(180, Number(tamano) || 512));

    const png = await toBuffer(url, {
      width: ancho,
      margin: 2,
      color: { dark: '#0E6E6B', light: '#FFFFFF' },
      errorCorrectionLevel: 'M',
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(png);
  }

  private async exigirCaptcha(token: string | undefined, ip: string): Promise<void> {
    if (!this.captcha.activo) return;
    if (!(await this.captcha.verificar(token, ip))) {
      throw new BadRequestException('Verificación de seguridad fallida. Inténtalo de nuevo.');
    }
  }
}
