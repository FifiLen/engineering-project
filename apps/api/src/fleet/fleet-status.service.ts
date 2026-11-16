import { deriveFleetStatus, type ScooterCondition } from '@hulajnogi/core';
import { DrizzleScooterRepository } from '@hulajnogi/db';
import type { FleetStatus } from '@hulajnogi/shared';
import { Injectable } from '@nestjs/common';

const THRESHOLD_TTL_MS = 60_000;

/**
 * Status floty dla zdarzeń na żywo liczony regułą z packages/core. Próg niskiej baterii pochodzi
 * z obowiązującego cennika i jest pamiętany przez minutę, żeby każda partia telemetrii nie pytała bazy.
 */
@Injectable()
export class FleetStatusService {
  private threshold: { value: number; at: number } | null = null;

  constructor(private readonly scooters: DrizzleScooterRepository) {}

  async lowBatteryThreshold(): Promise<number> {
    if (!this.threshold || Date.now() - this.threshold.at > THRESHOLD_TTL_MS) {
      this.threshold = { value: await this.scooters.lowBatteryThreshold(), at: Date.now() };
    }
    return this.threshold.value;
  }

  async statusOf(scooter: ScooterCondition): Promise<FleetStatus> {
    return deriveFleetStatus(scooter, await this.lowBatteryThreshold());
  }
}
