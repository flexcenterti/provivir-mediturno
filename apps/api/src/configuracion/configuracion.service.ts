import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Parámetros de reglas fuera del código (Arquitectura §9): hueco_max, ventanas,
 * umbrales de IA, KIOSKO_ACTIVO. Se cachean en memoria porque el motor los consulta
 * en cada cálculo de cupos; `invalidar()` se llama al escribirlos.
 */
@Injectable()
export class ConfiguracionService implements OnModuleInit {
  private cache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.recargar();
  }

  async recargar(): Promise<void> {
    const filas = await this.prisma.configuracion.findMany();
    this.cache = new Map(filas.map((f) => [f.clave, f.valor]));
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
