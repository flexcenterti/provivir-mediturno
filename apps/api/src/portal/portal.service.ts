import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CitasService } from '../citas/citas.service';
import { RecordatoriosService } from '../recordatorios/recordatorios.service';
import { enmascararDocumento } from '../comun/pii';
import type { AgendarDto, CuposPortalDto, IdentificarDto, RegistrarPacienteDto } from './dto/portal.dto';

/** Mensaje único para documento inexistente y teléfono que no coincide: sin enumeración. */
const MENSAJE_NO_COINCIDE =
  'Los datos no coinciden con ningún registro. Verifícalos o continúa como paciente nuevo.';

/** La sesión del portal vive poco: solo debe durar lo que toma escoger un cupo. */
const TTL_SESION = '20m';

interface SesionPortal {
  pacienteId: string;
  portal: true;
}

@Injectable()
export class PortalService {
  private readonly log = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citas: CitasService,
    private readonly recordatorios: RecordatoriosService,
    private readonly auditoria: AuditoriaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Catálogo visible en el portal. Sin datos internos: solo lo que el paciente elige. */
  async servicios() {
    const servicios = await this.prisma.servicio.findMany({
      where: { activo: true },
      orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }],
      select: { id: true, nombre: true, categoria: true, duracionMin: true, requiereOrden: true },
    });
    return servicios;
  }

  /**
   * RN-10.2 · paciente registrado. La respuesta es idéntica cuando el documento no
   * existe y cuando el teléfono no coincide, para no confirmar quién es paciente.
   */
  async identificar(dto: IdentificarDto) {
    const paciente = await this.prisma.paciente.findUnique({
      where: { documento: dto.documento },
      select: { id: true, nombres: true, apellidos: true, telefono: true, whatsapp: true, activo: true },
    });

    const telefono = (paciente?.telefono ?? paciente?.whatsapp ?? '').replace(/\D/g, '');
    const coincide =
      paciente?.activo === true && telefono.length >= 4 && telefono.slice(-4) === dto.telefonoUltimos4;

    if (!coincide) {
      this.log.warn(`Portal · identificación fallida para doc ${enmascararDocumento(dto.documento)}`);
      throw new UnauthorizedException(MENSAJE_NO_COINCIDE);
    }

    return {
      sesion: await this.firmarSesion(paciente!.id),
      paciente: { nombres: paciente!.nombres, apellidos: paciente!.apellidos },
    };
  }

  /** RN-10.4 · los pacientes creados por este canal quedan marcados como autoagendamiento. */
  async registrar(dto: RegistrarPacienteDto) {
    const existente = await this.prisma.paciente.findUnique({ where: { documento: dto.documento } });

    // Si ya existe, no se revela: se pide identificarse por el otro camino.
    if (existente) {
      throw new BadRequestException(
        'Ya hay un registro con ese documento. Ingresa por "Paciente registrado".',
      );
    }

    const telefono = dto.telefono.replace(/[^\d+]/g, '');
    const paciente = await this.prisma.paciente.create({
      data: {
        documento: dto.documento,
        nombres: dto.nombres.trim(),
        apellidos: dto.apellidos.trim(),
        telefono,
        whatsapp: telefono,
        correo: dto.correo ?? null,
        origen: 'autoagendamiento',
        sedeId: SEDE_ID,
      },
    });

    await this.auditoria.registrar({
      usuario: 'portal',
      accion: 'Paciente creado desde el portal',
      entidad: `paciente/${paciente.id}`,
      detalle: `Documento ${enmascararDocumento(paciente.documento)} · aviso de privacidad aceptado`,
      estadoNext: 'Activo',
    });

    return {
      sesion: await this.firmarSesion(paciente.id),
      paciente: { nombres: paciente.nombres, apellidos: paciente.apellidos },
    };
  }

  /**
   * Los cupos salen del MISMO motor que usa el backoffice (Arquitectura §6):
   * el portal no calcula reglas, solo muestra lo que el motor ofrece.
   */
  cupos(dto: CuposPortalDto) {
    return this.citas.cupos({
      servicioId: dto.servicioId,
      fecha: dto.fecha,
      prestadorId: dto.prestadorId,
      limite: dto.limite ?? 12,
    } as never, { autoservicio: true });
  }

  /** RN-10.2 · confirmación con código único de atención. */
  async agendar(dto: AgendarDto) {
    const pacienteId = await this.verificarSesion(dto.sesion);

    const r = await this.citas.crearConAlternativas(
      {
        pacienteId,
        servicioId: dto.servicioId,
        fecha: dto.fecha,
        hora: dto.hora,
        prestadorId: dto.prestadorId,
        origen: 'autoagendamiento',
      } as never,
      'portal',
      // RN-04.6 · el paciente agenda solo: no puede tomar cupos de hoy.
      { autoservicio: true },
    );

    if (!r.creada) {
      return { creada: false as const, motivo: r.motivo, alternativas: r.alternativas };
    }

    // RN-10.3 · la confirmación también sale por WhatsApp, no solo en pantalla:
    // quien agenda desde el móvil cierra la pestaña y se queda sin el código. Se
    // encola aparte para que un fallo de Meta no tumbe una cita ya creada; si el
    // paciente nunca escribió por WhatsApp —lo habitual aquí— solo puede salir
    // como plantilla aprobada, y si no la hay queda registrado en auditoría.
    await this.recordatorios.programarConfirmacion(r.cita.id).catch((e: Error) => {
      this.log.error(`No se pudo encolar la confirmación de ${r.cita.codigo}: ${e.message}`);
    });

    return {
      creada: true as const,
      confirmacion: {
        codigo: r.cita.codigo,
        paciente: `${r.cita.paciente.nombres} ${r.cita.paciente.apellidos}`,
        servicio: r.cita.servicio.nombre,
        prestador: r.cita.prestador.nombre,
        fecha: dto.fecha,
        hora: dto.hora,
        duracionMin: r.cita.duracionMin,
        indicaciones: r.cita.servicio.requiereOrden
          ? 'Recuerda traer tu orden médica el día de la cita.'
          : 'Preséntate en recepción 15 minutos antes.',
      },
    };
  }

  private firmarSesion(pacienteId: string): Promise<string> {
    const payload: SesionPortal = { pacienteId, portal: true };
    return this.jwt.signAsync(payload, {
      expiresIn: TTL_SESION,
      secret: this.config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  private async verificarSesion(sesion: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<SesionPortal>(sesion, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      // Un token del backoffice no debe servir para agendar por el portal.
      if (!payload.portal || !payload.pacienteId) throw new Error('token ajeno al portal');
      return payload.pacienteId;
    } catch {
      throw new UnauthorizedException('Tu sesión expiró. Vuelve a identificarte.');
    }
  }
}
