import { type DynamicModule, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { CONFIG, type AppConfig } from './config.js';
import { DatabaseModule } from './database/database.module.js';
import { FleetModule } from './fleet/fleet.module.js';
import { HealthController } from './health/health.controller.js';
import { MqttModule } from './mqtt/mqtt.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';
import { ZonesModule } from './zones/zones.module.js';

@Module({})
export class AppModule {
  /** Moduł główny dostaje gotową konfigurację, co ułatwia testy z inną bazą. */
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [DatabaseModule, AuthModule, MqttModule, RealtimeModule, ZonesModule, FleetModule, TelemetryModule],
      controllers: [HealthController],
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
