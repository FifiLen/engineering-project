/**
 * Odświeżanie strony na żądanie (ADR 0065): API po zmianie treści, cennika albo floty woła `POST /api/revalidate`
 * z `Authorization: Bearer ${SITE_REVALIDATE_SECRET}` i `{ tags: [...] }`. Każdy tag z białej listy dostaje
 * `revalidateTag(tag, { expire: 0 })`, więc pierwsze żądanie strony po zapisie w panelu czyta już nowe dane.
 */
import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { SITE_TAGS, type SiteTag } from '../../../lib/site/api';

/** Sekret wspólny z API; krótszy niż 32 znaki wyłącza odświeżanie (jak w konfiguracji API). */
const SECRET_MIN_LENGTH = 32;

const error = (status: number, code: string, message: string) =>
  NextResponse.json({ code, message, details: null }, { status });

function authorized(header: string | null): boolean {
  const secret = process.env.SITE_REVALIDATE_SECRET ?? '';
  if (secret.length < SECRET_MIN_LENGTH || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  // Porównanie w stałym czasie; różna długość to od razu odmowa (długość sekretu nie jest tajemnicą).
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const isSiteTag = (value: unknown): value is SiteTag =>
  typeof value === 'string' && (SITE_TAGS as readonly string[]).includes(value);

export async function POST(request: NextRequest) {
  if (!authorized(request.headers.get('authorization'))) return error(401, 'UNAUTHENTICATED', 'Brak sekretu');
  const body = (await request.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = Array.isArray(body?.tags) ? body.tags : null;
  if (!tags?.length || !tags.every(isSiteTag)) {
    return error(400, 'VALIDATION_ERROR', `Oczekiwano { tags } z listy: ${SITE_TAGS.join(', ')}`);
  }
  for (const tag of new Set(tags)) revalidateTag(tag, { expire: 0 });
  return NextResponse.json({ revalidated: [...new Set(tags)], at: new Date().toISOString() });
}
