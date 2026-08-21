import {
  BadRequestException, Body, Controller, Get, Header, HttpCode, HttpStatus,
  Logger, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Publico } from '../auth/decorators/publico.decorator';
import { enmascararTelefono } from '../comun/pii';
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
  private readonly log = new Logger(WhatsappController.name);

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
    if (challenge === null) {
      this.log.warn(`Verificación rechazada: el token recibido no coincide (modo=${params['hub.mode']})`);
      throw new UnauthorizedException();
    }
    this.log.log('Verificación del webhook superada');
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
      // Sin esta traza, un META_APP_SECRET equivocado se ve igual que un mensaje
      // que nunca llegó: 401 silencioso y el paciente sin respuesta.
      this.log.warn(
        `Firma inválida: se descarta la entrega (${crudo.length} bytes, ` +
        `cabecera ${req.header('x-hub-signature-256') ? 'presente' : 'ausente'}). ` +
        'Revisa META_APP_SECRET.',
      );
      throw new UnauthorizedException('Firma inválida');
    }

    // Lo descartado se registra con su tipo: es la única pista de qué mandó el
    // paciente cuando algo no encaja, y llega sin datos personales.
    const mensajes = normalizarWebhook(cuerpo, (o) =>
      this.log.warn(`Mensaje descartado (tipo ${o.tipo}): ${o.motivo}`),
    );

    // Deja constancia de TODA entrega, incluidas las que no traen mensajes (acuses
    // de entrega y lectura). Es lo único que distingue «Meta no llamó» de «llamó y
    // no había nada que procesar», y esa diferencia decide dónde buscar el fallo.
    if (mensajes.length === 0) {
      this.log.log('Entrega recibida sin mensajes (acuse de estado)');
    } else {
      for (const m of mensajes) {
        this.log.log(`Mensaje entrante ${m.tipo} de ${enmascararTelefono(m.telefono)} (${m.waMessageId})`);
        await this.cola.encolarEntrante(m);
      }
    }

    return { recibido: true };
  }
}
