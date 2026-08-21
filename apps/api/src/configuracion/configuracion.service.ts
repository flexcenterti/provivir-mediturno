import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Parámetros de reglas fuera del código (Arquitectura §9): hueco_max, ventanas,
 * umbrales de IA, KIOSKO_ACTIVO. Se cachean en memoria porque el motor los consulta
 * en cada cálculo de cupos; `invalidar()` se llama al escribirlos.
 */
@Injectable()
export class ConfiguracionService implements OnModuleInit {
  private readonly log = new Logger(ConfiguracionService.name);
  private cache = new Map<string, string>();
  private cargada = false;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Precalentar la caché NO puede tumbar la API.
   *
   * Cada lectura tiene su valor por defecto, así que un fallo aquí degrada el
   * servicio, no lo impide. Antes, un esquema sin migrar mataba el arranque y el
   * contenedor entraba en un bucle de reinicios: el operador veía 142 reintentos
   * en vez de un mensaje que dijera qué hacer.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.recargar();
      this.cargada = true;
    } catch (e) {
      const codigo = (e as { code?: string }).code;
      if (codigo === 'P2021') {
        this.log.error(
          'La tabla `configuracion` no existe: la base no tiene las migraciones aplicadas. ' +
          'Ejecuta `prisma migrate deploy` antes de usar la plataforma.',
        );
      } else {
        this.log.error(`No se pudo leer la configuración: ${(e as Error).message}`);
      }
      this.log.warn('La API arranca con los valores por defecto de las reglas, en modo degradado.');
    }
  }

  /** Si es false, la API responde pero opera con valores por defecto. */
  get disponible(): boolean {
    return this.cargada;
  }

  async recargar(): Promise<void> {
    const filas = await this.prisma.configuracion.findMany();
    this.cache = new Map(filas.map((f) => [f.clave, f.valor]));
    this.cargada = true;
  }

  numero(clave: string, porDefecto: number): number {
    const v = this.cache.get(clave);
    if (v === undefined) return porDefecto;
    const n = Number(v);
    return Number.isFinite(n) ? n : porDefecto;
  }

  booleano(clave: string, porDefecto: boolean): boolean {
    const v = this.cache.get(clave);
    return v === undefined ? porDefecto : v === 'true';
  }

  texto(clave: string, porDefecto: string): string {
    return this.cache.get(clave) ?? porDefecto;
  }

  async fijar(clave: string, valor: string): Promise<void> {
    await this.prisma.configuracion.upsert({
      where: { clave },
      update: { valor },
      create: { clave, valor },
    });
    this.cache.set(clave, valor);
  }

  todo(): Record<string, string> {
    return Object.fromEntries(this.cache);
  }
}
