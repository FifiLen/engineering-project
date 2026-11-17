import type { BlockReason, CustomerRecord, CustomerRepository } from '@hulajnogi/core';
import { usersResource, type ListQuery, type ListResponse, type UserListItem } from '@hulajnogi/shared';
import { and, eq, sql } from 'drizzle-orm';
import { runListQuery, type ListSource } from '../admin/list-query.js';
import type { DbExecutor } from '../client.js';
import { users, vUserActivity } from '../schema/schema.js';
import { rethrowUniqueViolation } from './errors.js';

type UserField = keyof typeof usersResource.fields;

const listSource: ListSource<UserField> = {
  from: vUserActivity,
  id: vUserActivity.id,
  columns: {
    id: vUserActivity.id,
    name: vUserActivity.name,
    phone: vUserActivity.phone,
    email: vUserActivity.email,
    status: vUserActivity.status,
    blockedReason: vUserActivity.blockedReason,
    blockedAt: vUserActivity.blockedAt,
    rides: vUserActivity.rides,
    lastRideAt: vUserActivity.lastRideAt,
    totalSpent: vUserActivity.totalSpent,
    walletBalance: vUserActivity.walletBalance,
    unpaidRentals: vUserActivity.unpaidRentals,
    ticketsReported: vUserActivity.ticketsReported,
    activeSessions: vUserActivity.activeSessions,
    lastSeenAt: vUserActivity.lastSeenAt,
    createdAt: vUserActivity.createdAt,
    version: vUserActivity.version,
  },
};

const record = {
  id: users.id,
  phone: users.phone,
  email: users.email,
  name: users.name,
  status: users.status,
  version: users.version,
};

/** Moduł Konta: klienci aplikacji (ADR 0019, ADR 0028). */
export class DrizzleCustomerRepository implements CustomerRepository {
  constructor(private readonly db: DbExecutor) {}

  list(query: ListQuery): Promise<ListResponse<UserListItem>> {
    return runListQuery<UserField, UserListItem>(this.db, usersResource, listSource, query);
  }

  async details(id: string): Promise<UserListItem | null> {
    const [row] = await this.db.select(listSource.columns).from(vUserActivity).where(eq(vUserActivity.id, id));
    return (row as unknown as UserListItem | undefined) ?? null;
  }

  async findByPhone(phone: string): Promise<CustomerRecord | null> {
    const [row] = await this.db.select(record).from(users).where(eq(users.phone, phone));
    return row ?? null;
  }

  async findById(id: string): Promise<CustomerRecord | null> {
    const [row] = await this.db.select(record).from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async createOrGet(phone: string): Promise<{ record: CustomerRecord; created: boolean }> {
    // Dwa równoległe potwierdzenia kodu dla nowego numeru: unikalność numeru rozstrzyga baza.
    const [row] = await this.db.insert(users).values({ phone }).onConflictDoNothing().returning(record);
    if (row) return { record: row, created: true };
    return { record: (await this.findByPhone(phone))!, created: false };
  }

  async updateProfile(
    id: string,
    version: number,
    changes: { name?: string; email?: string | null },
  ): Promise<boolean> {
    const set = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    try {
      const rows = await this.db
        .update(users)
        .set({ ...set, version: sql`${users.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(users.id, id), eq(users.version, version)))
        .returning({ id: users.id });
      return rows.length > 0;
    } catch (error) {
      rethrowUniqueViolation(error);
    }
  }

  async block(id: string, version: number, reason: BlockReason, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({
        status: 'BLOCKED',
        blockedAt: now,
        blockedReason: reason,
        version: sql`${users.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(users.id, id), eq(users.version, version)))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  async unblock(id: string, version: number): Promise<boolean> {
    const rows = await this.db
      .update(users)
      .set({
        status: 'ACTIVE',
        blockedAt: null,
        blockedReason: null,
        version: sql`${users.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(users.id, id), eq(users.version, version)))
      .returning({ id: users.id });
    return rows.length > 0;
  }
}
