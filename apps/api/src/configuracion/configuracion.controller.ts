import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { ConfiguracionService } from './configuracion.service';
import { Permisos } from '../auth/decorators/permisos.decorator';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioAutenticado } from '../auth/auth.types';

/**
 * Tope duro. El límite real se afina por clave más abajo: casi todo parámetro es
 * un número o una palabra, pero dos guardan documentos enteros y con 200
 * caracteres eran imposibles de configurar.
 */
class FijarValorDto {
  @IsString() @MaxLength(60_000)
  valor!: string;
}

const LIMITE_POR_DEFECTO = 200;

/**
 * Claves que legítimamente guardan texto largo:
 *  · `documentacion_comercial` — el documento del cliente (P6) que alimenta la importación.
 *  · `kb_temas_prohibidos` — la lista JSON de temas de escalamiento obligatorio (RN-13.4 · P12).
 * Con el tope general ninguna de las dos se podía guardar, así que P12 no tenía
 * dónde administrarse.
 */
const LIMITES: Record<string, number> = {
  documentacion_comercial: 60_000,
  kb_temas_prohibidos: 20_000,
};

/**
 * Qué valores se aceptan, por clave.
 *
 * La pantalla de Reglas pinta **todas** las claves como una casilla de texto libre, así
 * que sin esto cualquiera puede guardar basura en un parámetro que gobierna un canal
 * público. Los lectores caen a un valor base cuando no entienden lo guardado —eso los
 * hace robustos—, pero el operador tiene que enterarse al guardar y no tres días después
 * al ver que la regla no hace lo que la pantalla dice.
 *
 * Devuelve el motivo del rechazo, o `null` si el valor sirve.
 */
const VALIDADORES: Record<string, (v: string) => string | null> = {
  autoagendamiento_ventana_activa: (v) =>
    v === 'true' || v === 'false' ? null : 'Debe ser exactamente «true» o «false».',
  autoagendamiento_ventana_dias: (v) =>
    /^[1-7]:[1-7]-[1-7](,[1-7]:[1-7]-[1-7]){6}$/.test(v.trim())
      ? null
      : 'Formato: siete filas «día:desde-hasta» separadas por comas, con 1=lunes y 7=domingo.',
  autoagendamiento_dias_excluidos: (v) =>
    v.trim() === '' || /^[1-7](,[1-7])*$/.test(v.trim())
      ? null
      : 'Días de la semana separados por comas, con 1=lunes y 7=domingo. Vacío = ninguno.',
  autoagendamiento_horario_cita: validarFranja,
  autoagendamiento_horario_canal: validarFranja,
};

function validarFranja(v: string): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(v.trim());
  if (!m) return 'Formato: HH:MM-HH:MM en horas de 24, por ejemplo «12:00-18:00».';
  const desde = Number(m[1]) * 60 + Number(m[2]);
  const hasta = Number(m[3]) * 60 + Number(m[4]);
  return hasta > desde ? null : 'La hora final tiene que ser posterior a la inicial.';
}

@Controller('configuracion')
@Permisos('configuracion.editar')
export class ConfiguracionController {
  constructor(
    private readonly config: ConfiguracionService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  listar() {
    return this.config.todo();
  }

  @Put(':clave')
  async fijar(
    @Param('clave') clave: string,
    @Body() dto: FijarValorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    // El límite depende del `@Param`, que class-validator no ve desde el DTO.
    const limite = LIMITES[clave] ?? LIMITE_POR_DEFECTO;
    if (dto.valor.length > limite) {
      throw new BadRequestException(
        `El valor de «${clave}» supera el máximo de ${limite} caracteres (${dto.valor.length}).`,
      );
    }

    const motivo = VALIDADORES[clave]?.(dto.valor);
    if (motivo) throw new BadRequestException(`«${clave}»: ${motivo}`);

    const anterior = this.config.texto(clave, '');
    await this.config.fijar(clave, dto.valor);
    await this.auditoria.registrar({
      usuario: usuario.id,
      accion: 'Configuración modificada',
      entidad: `configuracion/${clave}`,
      estadoPrev: anterior,
      estadoNext: dto.valor,
    });
    return { clave, valor: dto.valor };
  }
}
