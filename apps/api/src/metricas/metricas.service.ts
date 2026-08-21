import { Injectable } from '@nestjs/common';
import { aMinutos } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AgendasService } from '../agendas/agendas.service';
import { porcentajeOcupacion } from '../citas/citas.reglas';
import { minutosEsperando } from '../turnos/turnos.reglas';

const ESTADOS_VIVOS = ['pendiente_llegada', 'confirmada', 'llego', 'en_atencion', 'atendida'] as const;

export interface CargaMedicoGeneral {
  prestadorId: string;
  nombre: string;
  /** RN-02.4 · métrica COMPARATIVA: solo consultas generales, sin controles. */
  consultasGenerales: number;
  controles: number;
  /** RN-02.5 · métrica de OCUPACIÓN: % del tiempo de jornada, controles incluidos. */
  ocupacionPorcentaje: number;
  minutosJornada: number;
  minutosOcupados: number;
}

@Injectable()
export class MetricasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agendas: AgendasService,
  ) {}

  /**
   * RN-02.5 · Panel de balanceo de medicina general.
   *
   * Devuelve DOS indicadores distintos que coexisten a propósito:
   *  · `consultasGenerales` — el conteo comparativo entre médicos, que EXCLUYE controles
   *    porque no facturan y distorsionan la equidad.
   *  · `ocupacionPorcentaje` — el % de la jornada ocupado, que SÍ incluye controles
   *    porque ocupan tiempo real de consultorio.
   * Confundirlos es el error clásico aquí: no se deben unificar.
   */
  async balanceoMedicinaGeneral(fechaIso: string): Promise<CargaMedicoGeneral[]> {
    const fecha = new Date(`${fechaIso}T00:00:00Z`);

    const medicos = await this.prisma.prestador.findMany({
      where: { grupoBalanceo: true, activo: true },
      orderBy: { nombre: 'asc' },
    });

    return Promise.all(
      medicos.map(async (m) => {
        const citas = await this.prisma.cita.findMany({
          where: { prestadorId: m.id, fecha, estado: { in: ESTADOS_VIVOS as never } },
          select: { horaInicio: true, duracionMin: true, tipo: true },
        });

        const agendasDelDia = await this.agendas.vigentesEnFecha(m.id, fecha);
        const minutosJornada = agendasDelDia.reduce(
          (s, a) => s + (aMinutos(a.horaFin) - aMinutos(a.horaIni)),
          0,
        );

        const consultasGenerales = citas.filter((c) => c.tipo === 'general').length;
        const controles = citas.filter((c) => c.tipo === 'control').length;
        const minutosOcupados = citas.reduce((s, c) => s + c.duracionMin, 0);

        return {
          prestadorId: m.id,
          nombre: m.nombre,
          consultasGenerales,
          controles,
          ocupacionPorcentaje: porcentajeOcupacion(
            citas.map((c) => ({ ...c, tipo: c.tipo as never })),
            minutosJornada,
          ),
          minutosJornada,
          minutosOcupados,
        };
      }),
    );
  }

  /**
   * Reporte operativo del rango: lo que el cliente comparte por pantallazo.
   * Incluye el desempeño del canal de WhatsApp para medir la promesa de RN-08.4
   * (resolución automática 30-40 % al arranque, 70-90 % con el tiempo).
   */
  async reporte(desde: string, hasta: string) {
    const rango = { gte: new Date(`${desde}T00:00:00Z`), lte: new Date(`${hasta}T00:00:00Z`) };

    const [resumen, porServicio, porPrestador, conversaciones, escaladas, resueltasPorIa] =
      await Promise.all([
        this.resumen(desde, hasta),
        this.prisma.cita.groupBy({
          by: ['servicioId'],
          where: { fecha: rango, estado: { not: 'cancelada' } },
          _count: { _all: true },
        }),
        this.prisma.cita.groupBy({
          by: ['prestadorId'],
          where: { fecha: rango, estado: { not: 'cancelada' } },
          _count: { _all: true },
        }),
        this.prisma.conversacion.count({ where: { creadoEn: rango } }),
        this.prisma.conversacion.count({ where: { creadoEn: rango, escalada: true } }),
        this.prisma.conversacion.count({ where: { creadoEn: rango, escalada: false, estado: 'resuelta' } }),
      ]);

    const servicios = await this.prisma.servicio.findMany({ select: { id: true, nombre: true } });
    const prestadores = await this.prisma.prestador.findMany({ select: { id: true, nombre: true } });
    const nombreServicio = new Map(servicios.map((s) => [s.id, s.nombre]));
    const nombrePrestador = new Map(prestadores.map((p) => [p.id, p.nombre]));

    return {
      ...resumen,
      porServicio: porServicio
        .map((f) => ({ servicio: nombreServicio.get(f.servicioId) ?? f.servicioId, citas: f._count._all }))
        .sort((a, b) => b.citas - a.citas),
      porPrestador: porPrestador
        .map((f) => ({ prestador: nombrePrestador.get(f.prestadorId) ?? f.prestadorId, citas: f._count._all }))
        .sort((a, b) => b.citas - a.citas),
      whatsapp: {
        conversaciones,
        escaladas,
        resueltasPorIa,
        // La métrica que el cliente va a mirar: qué porcentaje resolvió la IA sola.
        porcentajeResolucionIa: conversaciones > 0
          ? Math.round(((conversaciones - escaladas) / conversaciones) * 100)
          : 0,
      },
    };
  }

  /** KPIs del dashboard para un rango de fechas (Especificación §2.7). */
  async resumen(desde: string, hasta: string) {
    const desdeD = new Date(`${desde}T00:00:00Z`);
    const hastaD = new Date(`${hasta}T00:00:00Z`);
    const rango = { gte: desdeD, lte: hastaD };

    const [porEstado, porTipo, porOrigen, turnos] = await Promise.all([
      this.prisma.cita.groupBy({ by: ['estado'], where: { fecha: rango }, _count: { _all: true } }),
      this.prisma.cita.groupBy({ by: ['tipo'], where: { fecha: rango, estado: { not: 'cancelada' } }, _count: { _all: true } }),
      this.prisma.cita.groupBy({ by: ['origen'], where: { fecha: rango, estado: { not: 'cancelada' } }, _count: { _all: true } }),
      this.prisma.turno.findMany({
        where: { cita: { fecha: rango } },
        select: { llegadaTs: true, llamadoTs: true, estado: true },
      }),
    ]);

    const esperas = turnos
      .filter((t) => t.llamadoTs)
      .map((t) => minutosEsperando(t.llegadaTs, t.llamadoTs!));

    /** groupBy devuelve la clave agrupada junto al conteo; se aplana a { clave: n }. */
    const contar = <K extends string>(filas: Array<Record<K, string> & { _count: { _all: number } }>, clave: K) =>
      Object.fromEntries(filas.map((f) => [f[clave], f._count._all])) as Record<string, number>;

    return {
      rango: { desde, hasta },
      citas: {
        total: porEstado.reduce((s, f) => s + f._count._all, 0),
        porEstado: contar(porEstado, 'estado'),
        porTipo: contar(porTipo, 'tipo'),
        porOrigen: contar(porOrigen, 'origen'),
      },
      sala: {
        llegadas: turnos.length,
        enEspera: turnos.filter((t) => t.estado === 'en_espera').length,
        esperaPromedioMin: esperas.length ? Math.round(esperas.reduce((a, b) => a + b, 0) / esperas.length) : 0,
      },
      // Especificación §2.16 · el kiosko queda marcado como módulo apagado (D3).
      kiosko: { activo: false, llegadas: 0, nota: 'Módulo desactivado en esta etapa' },
    };
  }
}
