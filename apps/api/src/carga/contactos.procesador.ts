import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { parse } from 'csv-parse';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizarTelefono } from '../whatsapp/whatsapp.normalizador';

const TAMANIO_LOTE = 1_000;

export interface ResumenContactos {
  totalFilas: number;
  creados: number;
  actualizados: number;
  duplicados: number;
  invalidos: number;
}

const SIN_TILDES = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Encabezados de las exportaciones típicas de agenda telefónica (Google, iOS, vCard→CSV). */
const COLUMNAS_NOMBRE = ['nombre', 'name', 'nombre completo', 'display name', 'first name', 'given name'];
const COLUMNAS_APELLIDO = ['apellido', 'apellidos', 'last name', 'family name'];
const COLUMNAS_TELEFONO = [
  'telefono', 'teléfono', 'phone', 'celular', 'movil', 'móvil', 'numero', 'número',
  'phone 1 - value', 'mobile phone', 'phone number',
];

/**
 * RN-09.5 · Importador del CSV de contactos del celular del cliente (P9).
 *
 * Se cargan ANTES de migrar el número a la API: cuando alguien escriba, la
 * plataforma puede saludarlo por su nombre aunque no esté registrado como paciente.
 * NO crea pacientes: un contacto del celular no tiene documento y no es historia.
 */
@Injectable()
export class ContactosProcesador {
  private readonly log = new Logger(ContactosProcesador.name);

  constructor(private readonly prisma: PrismaService) {}

  async procesar(rutaArchivo: string, nombreOriginal: string): Promise<ResumenContactos> {
    const resumen: ResumenContactos = {
      totalFilas: 0, creados: 0, actualizados: 0, duplicados: 0, invalidos: 0,
    };

    let mapa: { nombre?: number; apellido?: number; telefono?: number } | null = null;
    let lote: Array<{ telefono: string; nombre: string }> = [];
    const vistos = new Set<string>();

    const lector = createReadStream(rutaArchivo).pipe(
      parse({ bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }),
    );

    try {
      for await (const celdas of lector as AsyncIterable<string[]>) {
        if (mapa === null) {
          mapa = this.mapear(celdas);
          if (mapa.telefono === undefined) {
            throw new Error('El archivo no trae una columna de teléfono reconocible');
          }
          continue;
        }

        resumen.totalFilas++;

        const telefonoCrudo = celdas[mapa.telefono!]?.trim();
        // Una agenda real trae entradas sin número: no son un error, simplemente no sirven.
        if (!telefonoCrudo || telefonoCrudo.replace(/\D/g, '').length < 7) {
          resumen.invalidos++;
          continue;
        }

        const telefono = normalizarTelefono(telefonoCrudo.split(/[;,/]/)[0]!.trim());
        const nombre = [
          mapa.nombre !== undefined ? celdas[mapa.nombre] : '',
          mapa.apellido !== undefined ? celdas[mapa.apellido] : '',
        ].filter(Boolean).join(' ').trim();

        if (!nombre) {
          resumen.invalidos++;
          continue;
        }

        // Un mismo contacto suele aparecer varias veces (casa, celular, trabajo).
        if (vistos.has(telefono)) {
          resumen.duplicados++;
          continue;
        }
        vistos.add(telefono);

        lote.push({ telefono, nombre: nombre.slice(0, 120) });

        if (lote.length >= TAMANIO_LOTE) {
          await this.guardarLote(lote, resumen);
          lote = [];
        }
      }

      if (lote.length > 0) await this.guardarLote(lote, resumen);

      this.log.log(
        `Contactos "${nombreOriginal}": ${resumen.totalFilas} filas · ${resumen.creados} creados · ` +
        `${resumen.actualizados} actualizados · ${resumen.duplicados} duplicados · ${resumen.invalidos} inválidos`,
      );

      return resumen;
    } finally {
      await unlink(rutaArchivo).catch(() => undefined);
    }
  }

  private mapear(encabezados: string[]): { nombre?: number; apellido?: number; telefono?: number } {
    const norm = encabezados.map(SIN_TILDES);
    const buscar = (alias: string[]) => {
      const i = norm.findIndex((h) => alias.some((a) => SIN_TILDES(a) === h));
      return i >= 0 ? i : undefined;
    };
    return {
      nombre: buscar(COLUMNAS_NOMBRE),
      apellido: buscar(COLUMNAS_APELLIDO),
      telefono: buscar(COLUMNAS_TELEFONO),
    };
  }

  private async guardarLote(
    lote: Array<{ telefono: string; nombre: string }>,
    resumen: ResumenContactos,
  ): Promise<void> {
    const existentes = await this.prisma.contacto.findMany({
      where: { telefono: { in: lote.map((c) => c.telefono) } },
      select: { telefono: true },
    });
    const yaEstan = new Set(existentes.map((e) => e.telefono));

    const nuevos = lote.filter((c) => !yaEstan.has(c.telefono));
    if (nuevos.length > 0) {
      await this.prisma.contacto.createMany({ data: nuevos, skipDuplicates: true });
      resumen.creados += nuevos.length;
    }

    for (const c of lote.filter((c) => yaEstan.has(c.telefono))) {
      await this.prisma.contacto.update({ where: { telefono: c.telefono }, data: { nombre: c.nombre } });
      resumen.actualizados++;
    }
  }
}
