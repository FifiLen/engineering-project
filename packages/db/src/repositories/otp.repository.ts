import type { OtpRecord, OtpRepository } from '@hulajnogi/core';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { otpCodes } from '../schema/schema.js';

/** Moduł Konta: jednorazowe kody SMS (skrót kodu, nigdy sam kod; ADR 0019). */
export class DrizzleOtpRepository implements OtpRepository {
  constructor(private readonly db: DbExecutor) {}

  async issuedSince(phone: string, since: Date): Promise<Date[]> {
    const rows = await this.db
      .select({ createdAt: otpCodes.createdAt })
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), gte(otpCodes.createdAt, since)));
    return rows.map((r) => r.createdAt);
  }

  /** Cel kodu (ADR 0076): `REGISTER`, gdy numer nie ma jeszcze konta, inaczej logowanie. */
  async create(
    phone: string,
    codeHash: string,
    expiresAt: Date,
    purpose: 'LOGIN' | 'REGISTER' = 'LOGIN',
  ): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(otpCodes)
      .values({ phone, codeHash, expiresAt, purpose })
      .returning({ id: otpCodes.id });
    return row!;
  }

  async findLatest(phone: string): Promise<OtpRecord | null> {
    const [row] = await this.db
      .select({
        id: otpCodes.id,
        codeHash: otpCodes.codeHash,
        attempts: otpCodes.attempts,
        expiresAt: otpCodes.expiresAt,
        consumedAt: otpCodes.consumedAt,
      })
      .from(otpCodes)
      .where(eq(otpCodes.phone, phone))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1);
    return row ?? null;
  }

  async countAttempt(id: string): Promise<void> {
    await this.db
      .update(otpCodes)
      .set({ attempts: sql`${otpCodes.attempts} + 1` })
      .where(eq(otpCodes.id, id));
  }

  async consume(id: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(otpCodes)
      .set({ consumedAt: now })
      .where(and(eq(otpCodes.id, id), isNull(otpCodes.consumedAt)))
      .returning({ id: otpCodes.id });
    return rows.length > 0;
  }
}
