import type { NewSession, SessionRecord, SessionRepository } from '@hulajnogi/core';
import type { SessionView } from '@hulajnogi/shared';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { sessions, staffSessions } from '../schema/schema.js';

/**
 * Sesje klientów (`sessions`) i operatorów (`staff_sessions`) mają ten sam kształt i tę samą rotację
 * tokenu odświeżającego (ADR 0019); różnią się właścicielem i opisem urządzenia.
 */
type SessionTable = typeof sessions | typeof staffSessions;

abstract class DrizzleSessionRepository implements SessionRepository {
  protected abstract readonly table: SessionTable;
  protected abstract ownerColumn(): (typeof sessions)['userId'] | (typeof staffSessions)['staffId'];
  protected abstract deviceColumn(): (typeof sessions)['deviceName'] | (typeof staffSessions)['userAgent'];
  protected abstract revokeAllProcedure: 'sp_revoke_user_sessions' | 'sp_revoke_staff_sessions';

  constructor(protected readonly db: DbExecutor) {}

  protected abstract values(session: NewSession): Record<string, unknown>;

  /** Następca przy rotacji: pola urządzenia, których żądanie nie podało, z wiersza poprzednika (ADR 0076). */
  protected abstract inherit(next: NewSession, previous: Record<string, unknown>): NewSession;

  async create(session: NewSession): Promise<{ id: string; familyId: string }> {
    const t = this.table;
    const [row] = await this.db
      .insert(t)
      .values(this.values(session) as never)
      .returning({ id: t.id, familyId: t.familyId });
    return row!;
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const t = this.table;
    const [row] = await this.db
      .select({
        id: t.id,
        ownerId: this.ownerColumn(),
        familyId: t.familyId,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt,
        replacedBy: t.replacedBy,
      })
      .from(t)
      .where(eq(t.refreshTokenHash, tokenHash));
    return row ?? null;
  }

  /**
   * Blokada doradcza rodziny (albo właściciela) do końca transakcji. Rotacja i unieważnienie rodziny (albo wszystkich
   * sesji właściciela) idą po kolei: bez niej unieważnienie w `READ COMMITTED` czekało na wiersz poprzednika, ale nie
   * widziało następcy wstawionego przez równoległą rotację, więc następca zostawał ważny (wyścig „Wyloguj” z
   * odświeżeniem tokenu). Pierwszy klucz to nazwa tabeli i rodzaju, drugi skrót identyfikatora.
   */
  private async lock(db: DbExecutor, kind: 'family' | 'owner', id: string): Promise<void> {
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${this.lockName}:${kind}`}), hashtext(${id}::text))`);
  }

  protected abstract readonly lockName: 'sessions' | 'staff_sessions';

  async rotate(previousId: string, next: NewSession, now: Date): Promise<{ id: string; familyId: string } | null> {
    const t = this.table;
    // Serwis wykonuje całość w jednej transakcji, więc blokady trwają do jej zatwierdzenia (kolejność: właściciel,
    // potem rodzina; unieważnienia biorą tylko jedną z nich, więc nie ma cyklu).
    const familyId =
      next.familyId ??
      (await this.db.select({ familyId: t.familyId }).from(t).where(eq(t.id, previousId)))[0]?.familyId;
    if (!familyId) return null;
    await this.lock(this.db, 'owner', next.ownerId);
    await this.lock(this.db, 'family', familyId);
    // Najpierw unieważnienie poprzednika: przy dwóch równoległych rotacjach wygrywa jedna, a druga
    // nie tworzy osieroconego następcy.
    const claimed = await this.db
      .update(t)
      .set({ revokedAt: now, lastUsedAt: now })
      .where(and(eq(t.id, previousId), isNull(t.revokedAt)))
      .returning();
    if (claimed.length === 0) return null;
    const created = await this.create(this.inherit(next, claimed[0] as Record<string, unknown>));
    await this.db.update(t).set({ replacedBy: created.id }).where(eq(t.id, previousId));
    return created;
  }

  async revoke(id: string, now: Date): Promise<void> {
    const t = this.table;
    await this.db
      .update(t)
      .set({ revokedAt: now })
      .where(and(eq(t.id, id), isNull(t.revokedAt)));
  }

  /**
   * Unieważnia rodzinę pod blokadą rodziny: zapytanie zaczyna się po zatwierdzeniu równoległej rotacji, więc widzi
   * jej następcę. Wywołane poza transakcją otwiera własną (blokada `xact` musi trwać do końca zapytania), w transakcji
   * działa w punkcie zapisu tej transakcji.
   */
  async revokeFamily(familyId: string, now: Date): Promise<number> {
    const t = this.table;
    return this.db.transaction(async (tx) => {
      await this.lock(tx, 'family', familyId);
      const rows = await tx
        .update(t)
        .set({ revokedAt: now })
        .where(and(eq(t.familyId, familyId), isNull(t.revokedAt)))
        .returning({ id: t.id });
      return rows.length;
    });
  }

  /** Wszystkie sesje właściciela pod blokadą właściciela (ta sama ochrona przed równoległą rotacją). */
  async revokeAllForOwner(ownerId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx, 'owner', ownerId);
      const result = await tx.execute<{ revoked_count: number }>(
        // Procedura z migracji 0004 (ADR 0026); nazwa pochodzi z klasy, a nie z danych wejściowych.
        sqlCall(this.revokeAllProcedure, ownerId),
      );
      return Number(result.rows[0]?.revoked_count ?? 0);
    });
  }

  /** Aktywne sesje właściciela do karty klienta albo operatora w panelu. */
  async active(ownerId: string, now: Date): Promise<SessionView[]> {
    const t = this.table;
    const rows = await this.db
      .select({
        id: t.id,
        device: this.deviceColumn(),
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        expiresAt: t.expiresAt,
      })
      .from(t)
      .where(and(eq(this.ownerColumn(), ownerId), isNull(t.revokedAt), gt(t.expiresAt, now)))
      .orderBy(desc(t.createdAt));
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
    }));
  }
}

function sqlCall(procedure: 'sp_revoke_user_sessions' | 'sp_revoke_staff_sessions', ownerId: string) {
  return sql`CALL ${sql.raw(procedure)}(${ownerId}, NULL)`;
}

export class DrizzleCustomerSessionRepository extends DrizzleSessionRepository {
  protected readonly table = sessions;
  protected readonly lockName = 'sessions' as const;
  protected readonly revokeAllProcedure = 'sp_revoke_user_sessions' as const;
  protected ownerColumn() {
    return sessions.userId;
  }
  protected deviceColumn() {
    return sessions.deviceName;
  }
  protected values(s: NewSession) {
    return {
      userId: s.ownerId,
      ...(s.familyId ? { familyId: s.familyId } : {}),
      refreshTokenHash: s.tokenHash,
      expiresAt: s.expiresAt,
      deviceName: s.device,
      platform: s.platform ?? null,
      appVersion: s.appVersion ?? null,
    };
  }
  protected inherit(next: NewSession, previous: Record<string, unknown>): NewSession {
    return {
      ...next,
      device: next.device ?? (previous.deviceName as string | null) ?? null,
      platform: next.platform ?? (previous.platform as NewSession['platform']) ?? null,
      appVersion: next.appVersion ?? (previous.appVersion as string | null) ?? null,
    };
  }
}

export class DrizzleStaffSessionRepository extends DrizzleSessionRepository {
  protected readonly table = staffSessions;
  protected readonly lockName = 'staff_sessions' as const;
  protected readonly revokeAllProcedure = 'sp_revoke_staff_sessions' as const;
  protected ownerColumn() {
    return staffSessions.staffId;
  }
  protected deviceColumn() {
    return staffSessions.userAgent;
  }
  protected values(s: NewSession) {
    return {
      staffId: s.ownerId,
      ...(s.familyId ? { familyId: s.familyId } : {}),
      refreshTokenHash: s.tokenHash,
      expiresAt: s.expiresAt,
      userAgent: s.device,
      remembered: s.remembered ?? false,
    };
  }
  protected inherit(next: NewSession, previous: Record<string, unknown>): NewSession {
    return { ...next, remembered: next.remembered ?? previous.remembered === true };
  }
}
