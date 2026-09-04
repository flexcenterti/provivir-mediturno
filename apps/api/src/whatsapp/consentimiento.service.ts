import { Injectable } from '@nestjs/common';
import { SEDE_ID } from '@provivir/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { enmascararTelefono } from '../comun/pii';

/** Se puede cambiar sin desplegar: la política vive en un PDF del sitio del cliente. */
const CLAVE_POLITICA = 'politica_datos_url';
const POLITICA_POR_DEFECTO =
  'https://grupoprovivir.com/wp-content/uploads/2020/10/' +
  'PD-POL%C3%8DTICA-DE-PRIVACIDAD-Y-TRATAMIENTO-DE-DATOS-PERSONALES.pdf';

/**
 * RN-09.10 · Autorización de tratamiento de datos por WhatsApp (Ley 1581 de 2012).
 *
 * La llave es el identificador de Meta, no el paciente: cuando alguien escribe por
 * primera vez no sabemos quién es, y el consentimiento hay que pedirlo antes de tratar
 * ningún dato suyo. El vínculo con el paciente se añade después, cuando confirma su
 * documento.
 */
@Injectable()
export class ConsentimientoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly configuracion: ConfiguracionService,
  ) {}

  /** La política vigente. Es también lo que se guarda en cada aceptación. */
  politicaUrl(): string {
    return this.configuracion.texto(CLAVE_POLITICA, POLITICA_POR_DEFECTO);
  }

  /** ¿Puede atenderse a este identificador? Solo un `aceptado` vigente abre la puerta. */
  async aceptado(identificador: string): Promise<boolean> {
    const registro = await this.prisma.consentimientoWhatsapp.findUnique({
      where: { identificador },
      select: { aceptado: true },
    });
    return registro?.aceptado === true;
  }

  /**
   * Registra la decisión. Es un upsert porque quien rechazó puede aceptar más adelante
   * —y al revés—: la tabla guarda el estado actual y la auditoría el historial, que es
   * lo que hay que poder mostrar si alguien reclama.
   */
  async registrar(identificador: string, acepta: boolean, pacienteId?: string): Promise<void> {
    const politicaUrl = this.politicaUrl();

    await this.prisma.consentimientoWhatsapp.upsert({
      where: { identificador },
      update: { aceptado: acepta, ts: new Date(), politicaUrl, ...(pacienteId ? { pacienteId } : {}) },
      create: {
        identificador,
        aceptado: acepta,
        politicaUrl,
        pacienteId: pacienteId ?? null,
        sedeId: SEDE_ID,
      },
    });

    await this.auditoria.registrar({
      usuario: 'whatsapp',
      accion: acepta ? 'Tratamiento de datos aceptado' : 'Tratamiento de datos rechazado',
      entidad: `consentimiento/${enmascararTelefono(identificador)}`,
      detalle: `Ley 1581/2012 · política ${politicaUrl}`,
      estadoNext: acepta ? 'Aceptado' : 'Rechazado',
    });
  }

  /**
   * Ata el consentimiento a la persona una vez identificada, que es lo que permite
   * responder «esta persona autorizó, el tal día, esta política».
   *
   * No pisa un vínculo ya hecho ni crea el registro si no existe: si alguien llegó a
   * identificarse sin haber aceptado, el problema es otro y no se tapa aquí.
   */
  async enlazarPaciente(identificador: string, pacienteId: string): Promise<void> {
    await this.prisma.consentimientoWhatsapp.updateMany({
      where: { identificador, pacienteId: null },
      data: { pacienteId },
    });
  }
}
