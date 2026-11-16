import { DomainError, ensureCanInvite, invitationExpiresAt, normalizeEmail } from '@hulajnogi/core';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createDb } from './client.js';
import { DrizzleInvitationRepository, DrizzleStaffRepository } from './repositories/staff.repository.js';
import { roles, staffRoles } from './schema/schema.js';
import { generateToken, hashToken } from './tokens.js';

export interface AdministratorInvitation {
  staffId: string;
  token: string;
  expiresAt: Date;
  created: boolean;
}

/**
 * Pierwszy administrator (albo nowe zaproszenie dla administratora, który jeszcze nie ustawił hasła).
 * Panel nie ma formularza zakładania konta bez logowania, więc konto powstaje poleceniem w terminalu,
 * a hasło i TOTP operator ustawia sam z linku (ADR 0019, ADR 0028). Zaproszenie bez autora
 * (`invited_by` NULL) oznacza polecenie w terminalu; dziennik audytu wymaga autora, więc wpisu nie ma.
 */
export async function inviteAdministrator(
  pool: Pool,
  input: { email: string; name: string },
  now = new Date(),
): Promise<AdministratorInvitation> {
  const email = normalizeEmail(input.email);
  return createDb(pool).transaction(async (tx) => {
    const staff = new DrizzleStaffRepository(tx);
    const existing = await staff.findAuthByEmail(email);
    if (existing) ensureCanInvite(existing);
    let staffId = existing?.id;
    if (!staffId) {
      staffId = (await staff.createInvited({ email, name: input.name.trim() })).id;
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.name, 'Administrator'), eq(roles.isSystem, true)));
      if (!role) throw new DomainError('NOT_FOUND', { entity: 'role', id: 'Administrator' });
      await tx.insert(staffRoles).values({ staffId, roleId: role.id });
    }
    const token = generateToken();
    const expiresAt = invitationExpiresAt(now);
    await new DrizzleInvitationRepository(tx).create(staffId, hashToken(token), expiresAt, null, now);
    return { staffId, token, expiresAt, created: !existing };
  });
}
