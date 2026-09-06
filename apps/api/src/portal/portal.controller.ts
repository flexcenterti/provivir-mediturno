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
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  aviso() {
    return {
      responsable: 'Centro de Profesionales & Provivir · CPP Principal',
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

  /**
   * Límite holgado a propósito: es una lista estática y toda la sala de espera
   * puede compartir la IP pública del wifi de la sede. Apretarlo aquí solo
   * bloquearía pacientes legítimos sin proteger nada.
   */
  @Get('servicios')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  servicios() {
    return this.portal.servicios();
  }

  /**
   * RN-04.8 · Qué días y horas puede agendar este canal ahora mismo.
   *
   * Existe para que el paciente no adivine: sin esto el selector de fecha es libre y la
   * mayoría de las fechas devolverían un 400. Sale del **mismo** cálculo que usa la
   * guarda del motor —`ventanaDeAutoservicio()`— porque publicar fechas por un camino y
   * validarlas por otro es ofrecerle al paciente días que luego se le rechazan.
   *
   * Devuelve `null` cuando la regla está apagada: entonces no hay ventana que anunciar.
   */
  @Get('ventana')
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  ventana() {
    return this.portal.ventana();
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
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
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
   * RN-10.1 · El mismo enlace que codifica el QR, en texto.
   *
   * El backoffice lo necesita para mostrarlo y para el botón «Abrir el portal»;
   * el QR es una imagen y no se puede leer desde el navegador. Es una URL pública
   * destinada a carteles impresos: no hay nada que proteger, solo que limitar.
   */
  @Get('enlace')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  enlace() {
    return { url: this.config.get<string>('PORTAL_URL') ?? 'http://localhost:5174' };
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
