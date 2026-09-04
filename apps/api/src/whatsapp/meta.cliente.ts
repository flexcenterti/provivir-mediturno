import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { enmascararTelefono } from '../comun/pii';
import { esTelefono, paraEnviar } from './whatsapp.normalizador';
import { extensionDe } from './media.tipos';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface BotonInteractivo {
  id: string;
  titulo: string;
}

/**
 * Cliente de la WhatsApp Business Cloud API (D5 / RN-09.1).
 *
 * Los tokens de Meta viven solo en el servidor (checklist §4). Si no están
 * configurados, el cliente opera en modo simulación: registra lo que habría
 * enviado en vez de fallar, para que el resto del sistema sea probable sin
 * credenciales reales.
 */
/**
 * No se pudo entregar la respuesta a un paciente sin teléfono.
 *
 * Ya no debería ocurrir —el campo correcto es `recipient`— pero si Meta rechaza
 * el envío igualmente, reintentar no lo arregla: el destino no cambia. Quien lo
 * reciba pasa la conversación a una persona, que sí puede contestar desde la
 * bandeja de WhatsApp Business.
 */
export class DestinatarioSinTelefono extends Error {
  constructor(detalle: string) {
    super(`No se puede responder por API a un usuario sin teléfono: ${detalle}`);
    this.name = 'DestinatarioSinTelefono';
  }
}

@Injectable()
export class MetaCliente {
  private readonly log = new Logger(MetaCliente.name);
  private readonly token?: string;
  private readonly phoneNumberId?: string;
  private readonly dirMedia: string;

  constructor(private readonly config: ConfigService) {
    this.token = config.get<string>('META_ACCESS_TOKEN') || undefined;
    this.phoneNumberId = config.get<string>('META_PHONE_NUMBER_ID') || undefined;
    // Checklist §4.10 · la media va fuera del webroot.
    this.dirMedia = config.get<string>('DIR_MEDIA') ?? 'media';

    if (!this.configurado) {
      this.log.warn('Credenciales de Meta sin configurar: el canal WhatsApp opera en modo simulación');
    }
  }

  get configurado(): boolean {
    return Boolean(this.token && this.phoneNumberId);
  }

  /** RN-09.2 · las respuestas de la plataforma son siempre texto (se permiten enlaces). */
  async enviarTexto(telefono: string, texto: string): Promise<string> {
    return this.enviar(telefono, {
      type: 'text',
      text: { body: texto, preview_url: true },
    });
  }

  /**
   * Botones de respuesta rápida. Detrás de la bandera `whatsapp_botones_interactivos`
   * porque RN-09.2 dice "siempre texto" y el cambio está pendiente de aprobación
   * del cliente (ver docs/rn-09-8-oferta-web.md).
   */
  async enviarBotones(telefono: string, texto: string, botones: BotonInteractivo[]): Promise<string> {
    return this.enviar(telefono, {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: texto },
        action: {
          // Meta admite máximo 3 botones y 20 caracteres por título.
          buttons: botones.slice(0, 3).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.titulo.slice(0, 20) },
          })),
        },
      },
    });
  }

  /**
   * Plantilla preaprobada. Es la ÚNICA forma de escribirle a alguien fuera de la
   * ventana de 24 h (ver `ventana-meta.ts`): un recordatorio de cita o la
   * confirmación de un agendamiento por el portal salen casi siempre así.
   *
   * Los parámetros son POSICIONALES y el orden lo fija la plantilla aprobada en
   * Meta, no este código: `parametrosTicket()` en `whatsapp.plantillas.ts` es el
   * contrato, y ahí está documentado qué variable es cada una.
   */
  async enviarPlantilla(
    telefono: string,
    nombre: string,
    parametros: string[],
    idioma = 'es',
  ): Promise<string> {
    const cuerpo = parametros.length
      ? {
          components: [
            {
              type: 'body',
              parameters: parametros.map((texto) => ({ type: 'text', text: texto })),
            },
          ],
        }
      : {};

    return this.enviar(telefono, {
      type: 'template',
      template: { name: nombre, language: { code: idioma }, ...cuerpo },
    });
  }

  private async enviar(telefono: string, carga: Record<string, unknown>): Promise<string> {
    if (!this.configurado) {
      const simulado = `simulado-${randomUUID()}`;
      this.log.log(`[simulación] → ${enmascararTelefono(telefono)}: ${JSON.stringify(carga).slice(0, 160)}`);
      return simulado;
    }

    // `paraEnviar` quita la marca interna `wa:`, que Meta no conoce.
    const id = paraEnviar(telefono);

    /*
     * El destinatario va en un campo distinto según cómo se identifique:
     *   · teléfono           → `to`
     *   · nombre de usuario  → `recipient` (el identificador "CO.1023…")
     *
     * Poner el user_id en `to` devuelve 131009 «The phone number is malformed».
     * Comprobado contra la API: `recipient` se reconoce desde v21.0, así que no
     * hace falta subir de versión.
     */
    const destino = esTelefono(telefono) ? { to: id } : { recipient: id };

    try {
      return await this.postear({ recipient_type: 'individual', ...destino, ...carga });
    } catch (e) {
      if (esTelefono(telefono)) throw e;
      throw new DestinatarioSinTelefono((e as Error).message);
    }
  }

  private async postear(cuerpo: Record<string, unknown>): Promise<string> {
    const r = await fetch(`${GRAPH}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
    });

    if (!r.ok) {
      const detalle = await r.text();
      // El detalle va al log del servidor, nunca al paciente (checklist §4.9).
      throw new Error(`Meta rechazó el envío (${r.status}): ${detalle.slice(0, 300)}`);
    }

    const respuesta = (await r.json()) as { messages?: Array<{ id: string }> };
    return respuesta.messages?.[0]?.id ?? '';
  }

  /**
   * Descarga un adjunto del paciente. Meta entrega primero una URL temporal
   * que exige el token para el segundo salto.
   */
  async descargarMedia(mediaId: string, mimeType?: string): Promise<string | null> {
    if (!this.configurado) {
      this.log.log(`[simulación] descarga de media ${mediaId}`);
      return null;
    }

    try {
      const meta = await fetch(`${GRAPH}/${mediaId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!meta.ok) throw new Error(`metadata ${meta.status}`);

      const { url } = (await meta.json()) as { url: string };
      const archivo = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!archivo.ok || !archivo.body) throw new Error(`descarga ${archivo.status}`);

      // Nombre generado: nada de lo que envía el paciente toca el sistema de archivos.
      const ruta = join(this.dirMedia, `${randomUUID()}${extensionDe(mimeType)}`);
      await mkdir(dirname(ruta), { recursive: true });
      await pipeline(Readable.fromWeb(archivo.body as never), createWriteStream(ruta));

      return ruta;
    } catch (e) {
      this.log.error(`No se pudo descargar la media ${mediaId}: ${(e as Error).message}`);
      return null;
    }
  }
}
