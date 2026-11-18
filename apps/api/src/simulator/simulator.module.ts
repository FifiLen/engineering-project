import { Module } from '@nestjs/common';
import { SimulatorController } from './simulator.controller.js';
import { SimulatorService } from './simulator.service.js';

/** Sterowanie symulatorem floty z panelu przez MQTT (ADR 0059). */
@Module({ controllers: [SimulatorController], providers: [SimulatorService], exports: [SimulatorService] })
export class SimulatorModule {}
