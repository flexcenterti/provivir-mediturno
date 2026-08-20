import {
  BadRequestException, Body, Controller, Get, Header, HttpCode, HttpStatus,
  Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Publico } from '../auth/decorators/publico.decorator';
import { firmaValida, respuestaDeVerificacion } from './firma';
import { normalizarWebhook } from './whatsapp.normalizador';
import { WhatsappCola } from './whatsapp.cola';
import type { WebhookMeta } from './whatsapp.tipos';

/**
 * Webhook de Meta (Arquitectura §7.1).
 *
 * Es, junto con el portal, lo único expuesto sin login. La verificación de firma es
 * OBLIGATORIA: sin ella cualquiera que conozca la URL podría inyectar mensajes falsos
 * y hacer que la plataforma agende citas en nombre de otros.
 *
 * El webhook solo encola y responde 200 de inmediato: Meta reintenta si tardamos,
 * y procesar en línea multiplicaría los duplicados.
 */
@Controller('webhooks/whatsapp')
@Publico()
export class WhatsappController {
  constructor(
    private readonly config: ConfigService,
    private readonly cola: WhatsappCola,
  ) {}

  /** Verificación al registrar el webhook en el panel de Meta. */
  @Get()
  @Header('Content-Type', 'text/plain')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verificar(@Query() params: Record<string, string>): string {
    const esperado = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN') ?? '';
    const challenge = respuestaDeVerificacion(params, esperado);
    if (challenge === null) throw new UnauthorizedException();
    return challenge;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  // Meta puede ráfagar; el límite es alto pero existe para que un flood no nos tumbe.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async recibir(@Req() req: Request, @Body() cuerpo: WebhookMeta): Promise<{ recibido: boolean }> {
    const secreto = this.config.get<string>('META_APP_SECRET') ?? '';
    const crudo = (req as Request & { rawBody?: Buffer }).rawBody;

    if (!crudo) {
      // Sin cuerpo crudo no se puede verificar la firma: se rechaza en vez de confiar.
      throw new BadRequestException('Cuerpo no disponible para verificación');
    }

    if (!firmaValida(crudo, req.header('x-hub-signature-256'), secreto)) {
      throw new UnauthorizedException('Firma inválida');
    }

    const mensajes = normalizarWebhook(cuerpo);
    for (const m of mensajes) {
      await this.cola.encolarEntrante(m);
    }

    return { recibido: true };
  }
}
