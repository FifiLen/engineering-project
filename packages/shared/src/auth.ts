/**
 * Kontrakt uwierzytelniania (ADR 0019, ADR 0035): żądania i odpowiedzi wspólne dla API, aplikacji
 * i panelu. Reguły (limity, ważność, siła hasła) są w packages/core; tutaj tylko kształt danych.
 */
import { z } from 'zod';
import type { BlockReason, ConsentType, UserStatus } from './admin/access.js';
import { SESSION_PLATFORMS } from './admin/accounts.js';

const code6 = z.string().regex(/^\d{6}$/);

// ---------------------------------------------------------------------------------------------
// Klienci (aplikacja mobilna)
// ---------------------------------------------------------------------------------------------

export const otpRequestSchema = z.object({ phone: z.string().trim().min(9).max(20) });
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export interface OtpRequestResult {
  phone: string;
  expiresInSeconds: number;
  resendInSeconds: number;
  /** Ile kodów można jeszcze wysłać na ten numer w ciągu godziny. */
  remainingCodes: number;
}

export const otpVerifySchema = z.object({
  phone: otpRequestSchema.shape.phone,
  code: code6,
  /** Nazwa urządzenia do listy sesji w panelu, np. „iPhone 15”. */
  device: z.string().trim().max(80).nullable().default(null),
  /** Platforma i wersja aplikacji do listy sesji w panelu (ADR 0076); opcjonalne, starsze wersje ich nie wysyłają. */
  platform: z.enum(SESSION_PLATFORMS).nullable().default(null),
  appVersion: z.string().trim().min(1).max(32).nullable().default(null),
});
export type OtpVerify = z.infer<typeof otpVerifySchema>;

/** Odświeżenie: bez platformy i wersji sesja następna dziedziczy je po poprzedniej (aktualizacja aplikacji je zmienia). */
export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
  platform: otpVerifySchema.shape.platform.optional(),
  appVersion: otpVerifySchema.shape.appVersion.optional(),
});
export type RefreshRequest = z.infer<typeof refreshSchema>;

/** Dokąd aplikacja kieruje klienta: dane, akceptacja nowych wersji dokumentów, blokada, mapa. */
export type CustomerNextStep = 'PROFILE' | 'CONSENTS' | 'BLOCKED' | 'READY';

export interface CustomerTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface PendingDocument {
  consentType: ConsentType;
  slug: string;
  versionId: string;
  versionNo: number;
  title: string;
  changeSummary: string | null;
}

export interface MeResponse {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  status: UserStatus;
  blockedReason: BlockReason | null;
  nextStep: CustomerNextStep;
  /** Obowiązujące dokumenty do akceptacji (rejestracja albo nowa wersja). */
  pendingDocuments: PendingDocument[];
  marketingConsent: boolean;
  /** Minimalny wiek z obowiązującej wersji cennika (tekst zgody na ekranie danych). */
  minUserAge: number | null;
}

export interface CustomerSession extends CustomerTokens {
  me: MeResponse;
  /** Konto powstało przy tym logowaniu. */
  created: boolean;
}

export const registrationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).nullable().default(null),
  ageConfirmed: z.boolean(),
  /** Wersje dokumentów pokazane klientowi; muszą być obowiązujące. */
  acceptedVersionIds: z.array(z.uuid()).max(10),
  marketing: z.boolean().default(false),
});
export type Registration = z.infer<typeof registrationSchema>;

export const consentsAcceptSchema = z.object({ acceptedVersionIds: z.array(z.uuid()).min(1).max(10) });
export type ConsentsAccept = z.infer<typeof consentsAcceptSchema>;

export const profileUpdateSchema = z.object({
  name: registrationSchema.shape.name.optional(),
  email: registrationSchema.shape.email.optional(),
  marketing: z.boolean().optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export interface LegalDocumentView {
  slug: string;
  title: string;
  versionNo: number;
  bodyMd: string;
  publishedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Operatorzy (panel)
// ---------------------------------------------------------------------------------------------

export const staffLoginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(256),
  remember: z.boolean().default(false),
});
export type StaffLogin = z.infer<typeof staffLoginSchema>;

export interface TotpSetup {
  /** Klucz do przepisania ręcznie (base32). */
  secret: string;
  /** Adres `otpauth://` do kodu QR. */
  otpauthUrl: string;
}

export interface StaffLoginStep {
  step: 'TOTP' | 'TOTP_SETUP';
  /** Token drugiego kroku (5 min); nie daje dostępu do panelu. */
  mfaToken: string;
  email: string;
  totpSetup: TotpSetup | null;
}

export const totpVerifySchema = z.object({ mfaToken: z.string().min(20).max(2000), code: code6 });
export type TotpVerify = z.infer<typeof totpVerifySchema>;

export interface StaffMe {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface StaffSession {
  accessToken: string;
  expiresInSeconds: number;
  staff: StaffMe;
}

export interface InvitationView {
  email: string;
  name: string;
  invitedByName: string | null;
  expiresAt: string;
}

export const invitationAcceptSchema = z.object({
  name: z.string().trim().min(2).max(80),
  password: z.string().max(256),
});
export type InvitationAccept = z.infer<typeof invitationAcceptSchema>;

/** Ciasteczko z tokenem odświeżającym panelu (ADR 0035). */
export const STAFF_REFRESH_COOKIE = 'hj_staff_refresh';
