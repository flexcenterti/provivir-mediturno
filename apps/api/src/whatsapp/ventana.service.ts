import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VENTANA_META_HORAS, dentroDeVentanaMeta } from './ventana-meta';
import { variantesDeTelefono } from './whatsapp.normalizador';

export interface EstadoVentana {
  /** Cuándo escribió el paciente por última vez. `null` = nunca ha escrito. */
  ultimoEntranteTs: Date | null;
  dentro: boolean;
  /** Cuándo deja de admitirse el texto libre. `null` si nunca hubo ventana. */
  expiraTs: Date | null;
}

/**
 * Estado de la ventana de 24 h de Meta para un número, resuelto contra la base.
 *
 * `ventana-meta.ts` responde *si* un envío cabe en la ventana; esto responde *cuándo
 * la abrió el paciente*, que es la mitad que hay que ir a buscar. Vive aparte para que
 * aquella siga siendo una función pura, sin Prisma.
 *
 * Existe porque el mismo cálculo estaba en dos sitios con criterios distintos, y el de
 * los recordatorios comparaba el teléfono por igualdad exacta: un paciente con el
 * número guardado como `3001234567` que escribe desde `+573001234567` no se detectaba
 * nunca dentro de la ventana, así que su recordatorio se descartaba siempre.
 */
@Injectable()
export class VentanaService {
  constructor(private readonly prisma: PrismaService) {}

  async estado(telefono: string, ahora: Date = new Date()): Promise<EstadoVentana> {
    /*
     * Se busca en TODAS las conversaciones del número, no solo en la actual: Meta
     * cuenta la ventana por interlocutor. Importa de verdad desde que se pueden
     * reabrir hilos cerrados — el paciente pudo escribir en uno nuevo mientras el
     * viejo estaba resuelto.
     */
    const ultimo = await this.prisma.mensaje.findFirst({
      where: {
        direccion: 'entrante',
        conversacion: { telefono: { in: variantesDeTelefono(telefono) } },
      },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });

    if (!ultimo) return { ultimoEntranteTs: null, dentro: false, expiraTs: null };

    return {
      ultimoEntranteTs: ultimo.ts,
      dentro: dentroDeVentanaMeta(ultimo.ts, ahora),
      expiraTs: new Date(ultimo.ts.getTime() + VENTANA_META_HORAS * 60 * 60_000),
    };
  }
}
