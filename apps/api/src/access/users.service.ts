import { diffForAudit, ensureCanBlock, ensureCanUnblock, ensureVersion, notFound, redactSecrets } from '@hulajnogi/core';
import {
  type Database,
  type DbExecutor,
  DrizzleConsentRepository,
  DrizzleCustomerRepository,
  DrizzleCustomerSessionRepository,
} from '@hulajnogi/db';
import type { ListQuery, ListResponse, UserBlock, UserDetails, UserListItem, UserUpdate } from '@hulajnogi/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AuditedTransaction } from '../audit/audited-transaction.js';
import { DB } from '../database/database.module.js';

/**
 * Klienci w panelu (ADR 0028): dane, zgody, sesje, blokada i odblokowanie. Blokada wylogowuje klienta
 * ze wszystkich urządzeń; powód widzi klient, notatka trafia tylko do dziennika audytu.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly transaction: AuditedTransaction,
  ) {}

  list(query: ListQuery, db: DbExecutor = this.db): Promise<ListResponse<UserListItem>> {
    return new DrizzleCustomerRepository(db).list(query);
  }

  async details(id: string, db: DbExecutor = this.db): Promise<UserDetails> {
    const row = await new DrizzleCustomerRepository(db).details(id);
    if (!row) throw notFound('user', id);
    const [consents, sessions] = await Promise.all([
      new DrizzleConsentRepository(db).views(id),
      new DrizzleCustomerSessionRepository(db).active(id, new Date()),
    ]);
    return { ...row, consents, sessions };
  }

  async update(actorId: string, id: string, { version, ...changes }: UserUpdate): Promise<UserDetails> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const customers = new DrizzleCustomerRepository(tx);
      const record = await this.load(customers, id, version);
      const diff = diffForAudit(record, changes);
      if (Object.keys(diff).length === 0) return;
      if (!(await customers.updateProfile(id, version, changes))) ensureVersion(version, (await customers.findById(id))!.version);
      await audit({ action: 'user.updated', entityType: 'user', entityId: id, data: { changes: diff } });
    });
    return this.details(id);
  }

  async block(actorId: string, id: string, { version, reason, note }: UserBlock): Promise<UserDetails> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const customers = new DrizzleCustomerRepository(tx);
      const record = await this.load(customers, id, version);
      ensureCanBlock(record.status);
      if (!(await customers.block(id, version, reason, new Date()))) ensureVersion(version, (await customers.findById(id))!.version);
      const sessions = await new DrizzleCustomerSessionRepository(tx).revokeAllForOwner(id);
      await audit({
        action: 'user.blocked',
        entityType: 'user',
        entityId: id,
        data: redactSecrets({ reason, note, sessionsRevoked: sessions }),
      });
    });
    return this.details(id);
  }

  async unblock(actorId: string, id: string, version: number): Promise<UserDetails> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      const customers = new DrizzleCustomerRepository(tx);
      const record = await this.load(customers, id, version);
      ensureCanUnblock(record.status);
      if (!(await customers.unblock(id, version))) ensureVersion(version, (await customers.findById(id))!.version);
      await audit({ action: 'user.unblocked', entityType: 'user', entityId: id, data: {} });
    });
    return this.details(id);
  }

  async revokeSessions(actorId: string, id: string): Promise<UserDetails> {
    await this.transaction.run(actorId, async ({ tx, audit }) => {
      if (!(await new DrizzleCustomerRepository(tx).findById(id))) throw notFound('user', id);
      const sessions = await new DrizzleCustomerSessionRepository(tx).revokeAllForOwner(id);
      await audit({ action: 'user.sessions_revoked', entityType: 'user', entityId: id, data: { sessionsRevoked: sessions } });
    });
    return this.details(id);
  }

  private async load(customers: DrizzleCustomerRepository, id: string, version: number) {
    const record = await customers.findById(id);
    if (!record) throw notFound('user', id);
    ensureVersion(version, record.version);
    return record;
  }
}
