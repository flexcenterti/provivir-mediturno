import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * RN-09.2 · Transcripción de notas de voz.
 *
 * La arquitectura deja abierto el proveedor ("p. ej. Whisper API"), así que esto es
 * un puerto: se configura con la URL y la clave de un servicio compatible con
 * `POST /audio/transcriptions` (multipart). El cliente todavía no eligió proveedor (P6/P7).
 *
 * **Sin proveedor configurado, un audio NO se descarta ni se adivina: escala a la
 * asistente con el audio adjunto.** Inventar una transcripción sería peor que no tenerla.
 */
@Injectable()
export class TranscripcionService {
  private readonly log = new Logger(TranscripcionService.name);
  private readonly url?: string;
  private readonly clave?: string;
  private readonly modelo: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('STT_URL') || undefined;
    this.clave = config.get<string>('STT_API_KEY') || undefined;
    this.modelo = config.get<string>('STT_MODELO') ?? 'whisper-1';

    if (!this.disponible) {
      this.log.warn('STT sin configurar: las notas de voz se escalarán a la asistente');
    }
  }

  get disponible(): boolean {
    return Boolean(this.url && this.clave);
  }

  async transcribir(rutaArchivo: string): Promise<string | null> {
    if (!this.disponible) return null;

    try {
      const datos = await readFile(rutaArchivo);
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(datos)]), basename(rutaArchivo));
      form.append('model', this.modelo);
      form.append('language', 'es');

      const r = await fetch(this.url!, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.clave}` },
        body: form,
      });

      if (!r.ok) throw new Error(`STT respondió ${r.status}`);

      const cuerpo = (await r.json()) as { text?: string };
      return cuerpo.text?.trim() || null;
    } catch (e) {
      this.log.error(`No se pudo transcribir ${basename(rutaArchivo)}: ${(e as Error).message}`);
      return null;
    }
  }
}
