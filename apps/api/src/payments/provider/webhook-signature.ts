import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '@hulajnogi/core';

/** Tolerancja znacznika czasu podpisu, jak w Stripe (5 min). */
const TOLERANCE_SECONDS = 300;

/**
 * Podpis webhooka atrapy w schemacie nagłówka `Stripe-Signature`: `t=<unix>,v1=<hex HMAC-SHA256(t.body)>`.
 * Ten sam punkt webhooka i ta sama weryfikacja co u Stripe, więc atrapa sprawdza całą ścieżkę (ADR 0050).
 */
export function signWebhook(body: string, secret: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  now = new Date(),
): void {
  const parts = Object.fromEntries(
    (header ?? '').split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')];
    }),
  );
  const t = Number(parts.t);
  const signature = parts.v1;
  if (!t || !signature || Math.abs(now.getTime() / 1000 - t) > TOLERANCE_SECONDS) {
    throw new DomainError('WEBHOOK_SIGNATURE_INVALID');
  }
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new DomainError('WEBHOOK_SIGNATURE_INVALID');
  }
}
