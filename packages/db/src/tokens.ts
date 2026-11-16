import { createHash, randomBytes } from 'node:crypto';

/**
 * Tokeny zapisywane w bazie wyłącznie jako skrót (tokeny odświeżające, zaproszenia; ADR 0019).
 * Token ma 256 bitów losowości, więc wystarczy SHA-256 bez soli: nie da się go odgadnąć ze skrótu,
 * a wyszukiwanie po skrócie działa przez indeks unikalny.
 */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
