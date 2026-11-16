import { Global, Module } from '@nestjs/common';
import { FleetGateway } from './fleet.gateway.js';

@Global()
@Module({ providers: [FleetGateway], exports: [FleetGateway] })
export class RealtimeModule {}
