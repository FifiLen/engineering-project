import { type DynamicModule, Module } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CONFIG, type AppConfig } from './config.js';
import { ContentModule } from './content/content.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DataExportModule } from './data-export/data-export.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { FilesModule } from './files/files.module.js';
import { FleetModule } from './fleet/fleet.module.js';
import { HealthController } from './health/health.controller.js';
import { JobsModule } from './jobs/jobs.module.js';
import { ListExportModule } from './common/list-export/list-export.module.js';
import { MqttModule } from './mqtt/mqtt.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OperationsModule } from './operations/operations.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RentalsModule } from './rentals/rentals.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SimulatorModule } from './simulator/simulator.module.js';
import { TelemetryModule } from './telemetry/telemetry.module.js';
import { ZonesModule } from './zones/zones.module.js';

@Module({})
export class AppModule {
  /** Moduł główny dostaje gotową konfigurację, co ułatwia testy z inną bazą. */
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        DatabaseModule,
        JobsModule,
        NotificationsModule,
        AuthModule,
        AccessModule,
        ListExportModule,
        MqttModule,
        RealtimeModule,
        FilesModule,
        ContentModule,
        DocumentsModule,
        DataExportModule,
        ReportsModule,
        ZonesModule,
        FleetModule,
        OperationsModule,
        RentalsModule,
        TelemetryModule,
        SimulatorModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
