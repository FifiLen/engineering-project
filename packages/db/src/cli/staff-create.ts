import { parseArgs } from 'node:util';
import { DomainError } from '@hulajnogi/core';
import { Pool } from 'pg';
import { inviteAdministrator } from '../bootstrap.js';
import { databaseUrl, requireEnv } from './env.js';

/**
 * Zaproszenie administratora z terminala:
 *   pnpm db:staff:create --email admin@operator.pl --name "Piotr Mazur"
 * Wypisuje link aktywacji ważny 72 h; hasło i TOTP administrator ustawia w panelu.
 */
async function main() {
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
  if (!values.email || !values.name) {
    console.error('Użycie: pnpm db:staff:create --email <e-mail> --name "<imię i nazwisko>"');
    process.exit(1);
  }
  const panelUrl = requireEnv('PANEL_URL', 'http://localhost:3000');
  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    const invitation = await inviteAdministrator(pool, { email: values.email, name: values.name });
    const link = `${panelUrl}/admin/aktywacja?token=${invitation.token}`;
    console.log(invitation.created ? 'Utworzono konto administratora.' : 'Wysłano nowe zaproszenie (poprzednie unieważnione).');
    console.log(`Link aktywacji (ważny do ${invitation.expiresAt.toISOString()}):\n${link}`);
  } catch (error) {
    if (error instanceof DomainError) {
      console.error(`Nie utworzono zaproszenia: ${error.code}`);
      process.exit(1);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
