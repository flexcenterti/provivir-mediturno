import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

/**
 * Conexión Redis compartida por todas las colas (Arquitectura §2).
 * `maxRetriesPerRequest: null` lo exige BullMQ para los workers bloqueantes.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        return new Redis(url, { maxRetriesPerRequest: null });
      },
    },
  ],
  exports: [REDIS],
})
export class ColasModule {}
