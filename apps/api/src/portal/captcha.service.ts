import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * CAPTCHA ligero (Cloudflare Turnstile) para el portal público (Guía, FASE 5).
 *
 * Si no hay `TURNSTILE_SECRET` configurado, la verificación se omite y se avisa por
 * log: en desarrollo no hay clave, y bloquear el portal por eso impediría probarlo.
 * En producción la ausencia de la clave se registra como advertencia en cada arranque.
 */
@Injectable()
export class CaptchaService {
  private readonly log = new Logger(CaptchaService.name);
  private readonly secreto?: string;

  constructor(config: ConfigService) {
    this.secreto = config.get<string>('TURNSTILE_SECRET') || undefined;
    if (!this.secreto) {
      this.log.warn('TURNSTILE_SECRET sin configurar: el portal público opera sin CAPTCHA');
    }
  }

  get activo(): boolean {
    return Boolean(this.secreto);
  }

  async verificar(token: string | undefined, ip: string): Promise<boolean> {
    if (!this.secreto) return true;
    if (!token) return false;

    try {
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: this.secreto, response: token, remoteip: ip }),
      });
      const cuerpo = (await r.json()) as { success?: boolean };
      return cuerpo.success === true;
    } catch (e) {
      // Si Cloudflare no responde, no se bloquea el agendamiento: se registra y se deja pasar.
      this.log.error('No se pudo verificar el CAPTCHA', e as Error);
      return true;
    }
  }
}
