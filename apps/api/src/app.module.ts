import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validarEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { ColasModule } from './colas/colas.module';
import { PacientesModule } from './pacientes/pacientes.module';
import { PrestadoresModule } from './prestadores/prestadores.module';
import { ServiciosModule } from './servicios/servicios.module';
import { AgendasModule } from './agendas/agendas.module';
import { CargaModule } from './carga/carga.module';
import { CitasModule } from './citas/citas.module';
import { TurnosModule } from './turnos/turnos.module';
import { PantallasModule } from './pantallas/pantallas.module';
import { MetricasModule } from './metricas/metricas.module';
import { PortalModule } from './portal/portal.module';
import { KioskoModule } from './kiosko/kiosko.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validarEnv, cache: true }),
    // Rate limit global. El portal público (Fase 5) endurece el suyo aparte.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('THROTTLE_TTL_MS'),
          limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
        },
      ],
    }),
    PrismaModule,
    AuditoriaModule,
    ConfiguracionModule,
    ColasModule,
    HealthModule,
    AuthModule,
    // Fase 1 · núcleo de datos
    PacientesModule,
    PrestadoresModule,
    ServiciosModule,
    AgendasModule,
    CargaModule,
    // Fase 2 · motor de agendamiento
    CitasModule,
    // Fase 3 · operación en sede
    TurnosModule,
    PantallasModule,
    MetricasModule,
    // Fase 5 · portal público y kiosko (apagado por bandera, D3)
    PortalModule,
    KioskoModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Orden importante: primero autentica, después autoriza por rol.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
