import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { parse } from 'csv-parse';
import { Injectable, Logger } from '@nestjs/common';
import { SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { enmascararDocumento } from '../comun/pii';
import {
  columnasFaltantes, dentroDelUltimoAnio, mapearEncabezados, normalizarFila,
} from './carga.normalizador';
import type { DatosTrabajoCarga, ErrorCarga, FilaNormalizada, ResumenCarga } from './carga.tipos';

/** Lotes: ni tan chicos que multipliquen viajes a la BD ni tan grandes que agoten memoria. */
const TAMANIO_LOTE = 1_000;
const MAX_ERRORES_REPORTADOS = 500;

@Injectable()
export class CargaProcesador {
  private readonly log = new Logger(CargaProcesador.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * RN-12 · streaming por lotes. El archivo nunca se carga entero en memoria:
   * 400.000 registros no caben cómodamente y bloquearían el proceso.
   */
  async procesar(
    datos: DatosTrabajoCarga,
    reportarProgreso?: (procesadas: number) => void | Promise<void>,
  ): Promise<ResumenCarga> {
    const resumen: ResumenCarga = {
      totalFilas: 0, creados: 0, actualizados: 0, duplicadosRechazados: 0,
      fueraDeFiltro: 0, erroneos: 0, historialesCreados: 0, errores: [],
    };

    const referencia = new Date();
    let mapa: ReturnType<typeof mapearEncabezados> | null = null;
    let lote: Array<{ fila: FilaNormalizada; numero: number }> = [];
    let numeroFila = 0;

    const lector = createReadStream(datos.rutaArchivo).pipe(
      parse({ bom: true, skip_empty_lines: true, relax_column_count: true, trim: true }),
    );

    try {
      for await (const celdas of lector as AsyncIterable<string[]>) {
        if (mapa === null) {
          mapa = mapearEncabezados(celdas);
          const faltantes = columnasFaltantes(mapa);
          if (faltantes.length > 0) {
            throw new Error(`El archivo no trae las columnas obligatorias: ${faltantes.join(', ')}`);
          }
          continue;
        }

        numeroFila++;
        resumen.totalFilas++;

        const { fila, motivo } = normalizarFila(celdas, mapa);
        if (!fila) {
          resumen.erroneos++;
          this.agregarError(resumen, { fila: numeroFila, motivo: motivo ?? 'Fila inválida', documento: '—' });
          continue;
        }

        if (datos.filtrarUltimoAnio && !dentroDelUltimoAnio(fila.fechaServicio, referencia)) {
          resumen.fueraDeFiltro++;
          continue;
        }

        lote.push({ fila, numero: numeroFila });

        if (lote.length >= TAMANIO_LOTE) {
          await this.procesarLote(lote, resumen);
          lote = [];
          await reportarProgreso?.(resumen.totalFilas);
        }
      }

      if (lote.length > 0) await this.procesarLote(lote, resumen);
      await reportarProgreso?.(resumen.totalFilas);

      this.log.log(
        `Carga "${datos.nombreOriginal}": ${resumen.totalFilas} filas · ` +
        `${resumen.creados} creados · ${resumen.actualizados} actualizados · ` +
        `${resumen.duplicadosRechazados} duplicados · ${resumen.fueraDeFiltro} fuera de filtro · ` +
        `${resumen.erroneos} con error`,
      );

      return resumen;
    } finally {
      // Checklist §4 · el archivo se elimina del disco al terminar, pase lo que pase.
      await unlink(datos.rutaArchivo).catch(() => undefined);
    }
  }

  /**
   * RN-12.5 · el documento es el identificador principal: la recarga rechaza duplicados
   * y actualiza lo que corresponda. "Rechazar" significa no crear otro registro;
   * los datos de contacto sí se refrescan porque la recarga suele traerlos más nuevos.
   */
  private async procesarLote(
    lote: Array<{ fila: FilaNormalizada; numero: number }>,
    resumen: ResumenCarga,
  ): Promise<void> {
    // Duplicados dentro del propio archivo: gana el primero.
    const vistos = new Set<string>();
    const unicos: Array<{ fila: FilaNormalizada; numero: number }> = [];
    for (const item of lote) {
      if (vistos.has(item.fila.documento)) {
        resumen.duplicadosRechazados++;
        continue;
      }
      vistos.add(item.fila.documento);
      unicos.push(item);
    }

    const documentos = unicos.map((u) => u.fila.documento);
    const existentes = await this.prisma.paciente.findMany({
      where: { documento: { in: documentos } },
      select: { id: true, documento: true },
    });
    const mapaExistentes = new Map(existentes.map((e) => [e.documento, e.id]));

    const nuevos = unicos.filter((u) => !mapaExistentes.has(u.fila.documento));
    const yaEstaban = unicos.filter((u) => mapaExistentes.has(u.fila.documento));

    if (nuevos.length > 0) {
      await this.prisma.paciente.createMany({
        data: nuevos.map(({ fila }) => ({
          documento: fila.documento,
          tdoc: fila.tdoc,
          nombres: fila.nombres,
          apellidos: fila.apellidos,
          telefono: fila.telefono ?? null,
          whatsapp: fila.telefono ?? null,
          correo: fila.correo ?? null,
          origen: 'carga' as const,
          sedeId: SEDE_ID,
        })),
        skipDuplicates: true,
      });
      resumen.creados += nuevos.length;
    }

    for (const { fila } of yaEstaban) {
      resumen.duplicadosRechazados++;
      if (fila.telefono || fila.correo) {
        await this.prisma.paciente.update({
          where: { documento: fila.documento },
          data: {
            ...(fila.telefono ? { telefono: fila.telefono, whatsapp: fila.telefono } : {}),
            ...(fila.correo ? { correo: fila.correo } : {}),
          },
        });
        resumen.actualizados++;
      }
    }

    // RN-12.4 · los servicios tomados alimentan el historial operativo.
    await this.registrarHistoriales(unicos, resumen);
  }

  private async registrarHistoriales(
    items: Array<{ fila: FilaNormalizada }>,
    resumen: ResumenCarga,
  ): Promise<void> {
    const conServicio = items.filter((i) => i.fila.servicio && i.fila.fechaServicio);
    if (conServicio.length === 0) return;

    const pacientes = await this.prisma.paciente.findMany({
      where: { documento: { in: conServicio.map((i) => i.fila.documento) } },
      select: { id: true, documento: true },
    });
    const idPorDocumento = new Map(pacientes.map((p) => [p.documento, p.id]));

    const filas = conServicio
      .map(({ fila }) => {
        const pacienteId = idPorDocumento.get(fila.documento);
        if (!pacienteId) return null;
        return { pacienteId, fecha: fila.fechaServicio!, servicioTexto: fila.servicio!.slice(0, 160) };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    if (filas.length > 0) {
      const r = await this.prisma.historialServicio.createMany({ data: filas, skipDuplicates: true });
      resumen.historialesCreados += r.count;
    }
  }

  private agregarError(resumen: ResumenCarga, error: ErrorCarga): void {
    if (resumen.errores.length < MAX_ERRORES_REPORTADOS) {
      resumen.errores.push({ ...error, documento: enmascararDocumento(error.documento) });
    }
  }
}
