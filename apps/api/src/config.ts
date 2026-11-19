import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .or(z.boolean());

/** Pusta wartość z `.env` (np. `JWT_SECRET=`) oznacza brak zmiennej. */
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().default('postgres://hulajnogi:hulajnogi@localhost:5432/hulajnogi'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  /** Adresy panelu i strony dopuszczone przez CORS (po przecinku); w trybie deweloperskim każdy localhost. */
  CORS_ORIGINS: z.string().default(''),
  MQTT_URL: z.string().default('mqtt://localhost:1883'),
  /** Jedna instancja backendu ma stały identyfikator, żeby po restarcie wznowić swoją sesję w brokerze. */
  MQTT_CLIENT_ID: z.string().min(1).default('hulajnogi-api'),
  /** Testy API działają bez brokera: wiadomości podaje test, a publikacje są tylko zapisywane. */
  MQTT_ENABLED: booleanFlag.default(true),
  /** Okno zbierania telemetrii przed zapisem do bazy i wysłaniem do panelu (ADR 0033). */
  TELEMETRY_FLUSH_MS: z.coerce.number().int().min(100).max(10_000).default(1000),
  /** Podpis tokenów dostępowych JWT (ADR 0035); w produkcji wymagany. */
  JWT_SECRET: optional(z.string().min(32)),
  /** Klucz AES-256-GCM sekretów TOTP: 32 bajty w base64 (ADR 0035); w produkcji wymagany. */
  TOTP_ENCRYPTION_KEY: optional(
    z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'Klucz musi mieć 32 bajty w base64'),
  ),
  /** Adres panelu w linkach zaproszeń operatorów. */
  PANEL_URL: z.url().default('http://localhost:3000'),
  /** Adres strony w kodach QR hulajnóg (ADR 0041); domena zależy od nazwy marki. */
  PUBLIC_SITE_URL: z.url().default('http://localhost:3000'),
  /**
   * Zadania w tle pg-boss (ADR 0037). Testy API wyłączają kolejkę: zaplanowane zadania są tylko
   * zapisywane, a test wywołuje ich obsługę bezpośrednio.
   */
  JOBS_ENABLED: booleanFlag.default(true),
  /** Trasy dla klienta (ADR 0048): OSRM z profilem rowerowym i pieszym; bez OSRM linia prosta. */
  OSRM_URL: z.url().default('http://localhost:5000'),
  OSRM_FOOT_URL: z.url().default('http://localhost:5002'),
  /** Wyszukiwanie miejsc (ADR 0045); własna instancja Photon to tylko zmiana adresu. */
  PHOTON_URL: z.url().default('https://photon.komoot.io'),
  /**
   * Operator płatności (ADR 0050): atrapa w procesie (testy, CI, demo bez sieci) albo Stripe w trybie
   * testowym po wpisaniu kluczy do `.env`. Kluczy nie ma w repozytorium.
   */
  PAYMENT_PROVIDER: z.enum(['fake', 'stripe']).default('fake'),
  STRIPE_SECRET_KEY: optional(z.string()),
  STRIPE_PUBLISHABLE_KEY: optional(z.string()),
  STRIPE_WEBHOOK_SECRET: optional(z.string()),
  /** BLIK przez Stripe (D2); działa w trybie testowym dla konta w PLN. */
  STRIPE_BLIK: booleanFlag.default(true),
  /** Podpis webhooków atrapy (ten sam schemat co `Stripe-Signature`). */
  FAKE_WEBHOOK_SECRET: z.string().min(16).default('whsec_fake_dev_only_not_a_secret'),
  /** `http`: atrapa wysyła webhooki do API po opóźnieniu; `manual`: test pobiera je i wysyła sam. */
  FAKE_WEBHOOK_DELIVERY: z.enum(['http', 'manual']).default('http'),
  FAKE_WEBHOOK_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(2000),
  /** Adres punktu webhooka dla atrapy; domyślnie to samo API. */
  FAKE_WEBHOOK_URL: optional(z.url()),
  /**
   * Magazyn plików (ADR 0057): SeaweedFS przez API S3 z `forcePathStyle`, albo pamięć procesu w testach API.
   * Wybór jak `PAYMENT_PROVIDER`; pamięć nie działa w produkcji.
   */
  FILE_STORAGE: z.enum(['s3', 'memory']).default('s3'),
  S3_ENDPOINT: z.url().default('http://localhost:8333'),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1).default('hulajnogi'),
  /** Klucze z `infra/seaweedfs/s3.json`; w produkcji wymagane. */
  S3_ACCESS_KEY: optional(z.string().min(1)),
  S3_SECRET_KEY: optional(z.string().min(1)),
  /**
   * Bramka powiadomień push (ADR 0058): atrapa w procesie (zapis `SENT` i log w API, jak kod SMS) albo Expo Push
   * po skonfigurowaniu projektu EAS przez autora. Token dostępu Expo jest opcjonalny.
   */
  PUSH_PROVIDER: z.enum(['fake', 'expo']).default('fake'),
  EXPO_ACCESS_TOKEN: optional(z.string().min(1)),
  /**
   * Sterowanie symulatorem z panelu (ADR 0059): domyślnie tylko przy `NODE_ENV=development`; przy `false` punkty
   * `/admin/simulator/*` zwracają 404, a API nie subskrybuje tematów symulatora.
   */
  SIMULATOR_CONTROL_ENABLED: optional(booleanFlag),
  /**
   * Odświeżanie strony na żądanie (ADR 0065, D2): zadanie `site.revalidate` woła `POST {SITE_REVALIDATE_URL}`
   * (Route Handler `/api/revalidate` w apps/web) z sekretem w nagłówku `Authorization`. Puste wyłącza wywołanie
   * (testy, CI); strona odświeża się wtedy sama po 5 min. Dane sprzedawcy na paragonie pochodzą z danych firmy
   * w bazie (ADR 0062), więc zmiennych `SELLER_*` już nie ma.
   */
  SITE_REVALIDATE_URL: optional(z.url()),
  SITE_REVALIDATE_SECRET: optional(z.string().min(32)),
  /**
   * Silnik dokumentów (ADR 0066): Gotenberg (LibreOffice i Chromium za HTTP, port tylko na pętli zwrotnej) albo
   * atrapa w testach API (DOCX naprawdę z docxtemplater, PDF stały). Wybór jak `PAYMENT_PROVIDER`; atrapa nie
   * działa w produkcji.
   */
  DOCUMENT_RENDERER: z.enum(['gotenberg', 'fake']).default('gotenberg'),
  GOTENBERG_URL: z.url().default('http://localhost:3010'),
  /** Limit klienta HTTP konwersji; po nim `RENDER_TIMEOUT` (Gotenberg ma własny `API_TIMEOUT=30s`). */
  GOTENBERG_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
});

/**
 * Wartości tylko dla środowiska deweloperskiego i testów. W produkcji brak sekretu zatrzymuje start,
 * żeby tokeny nie były podpisane kluczem znanym z repozytorium.
 */
const DEV_JWT_SECRET = 'dev-only-jwt-secret-not-for-production-use';
const DEV_TOTP_KEY = Buffer.alloc(32, 7).toString('base64');
/** Klucze SeaweedFS z `infra/seaweedfs/s3.json` (tylko lokalny magazyn deweloperski). */
const DEV_S3_KEYS = { access: 'hulajnogi', secret: 'hulajnogi-dev-secret' };

type ParsedEnv = z.infer<typeof envSchema>;
export type AppConfig = Omit<
  ParsedEnv,
  'JWT_SECRET' | 'TOTP_ENCRYPTION_KEY' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY' | 'SIMULATOR_CONTROL_ENABLED'
> & {
  SIMULATOR_CONTROL_ENABLED: boolean;
  JWT_SECRET: string;
  TOTP_ENCRYPTION_KEY: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
};

/** Konfiguracja z zmiennych środowiskowych, sprawdzana przy starcie (błąd = brak startu). */
export function loadConfig(env: NodeJS.ProcessEnv | Record<string, unknown> = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Nieprawidłowa konfiguracja:\n${z.prettifyError(parsed.error)}`);
  }
  const data = parsed.data;
  // z.preprocess traci typ wyniku; po walidacji to napis albo brak wartości.
  const jwtSecret = data.JWT_SECRET as string | undefined;
  const totpKey = data.TOTP_ENCRYPTION_KEY as string | undefined;
  if (data.NODE_ENV === 'production' && (!jwtSecret || !totpKey)) {
    throw new Error('Nieprawidłowa konfiguracja: w produkcji wymagane są JWT_SECRET i TOTP_ENCRYPTION_KEY');
  }
  checkPaymentConfig(data);
  if (data.SITE_REVALIDATE_URL && !data.SITE_REVALIDATE_SECRET) {
    throw new Error(
      'Nieprawidłowa konfiguracja: SITE_REVALIDATE_URL wymaga SITE_REVALIDATE_SECRET (co najmniej 32 znaki)',
    );
  }
  const s3Access = data.S3_ACCESS_KEY as string | undefined;
  const s3Secret = data.S3_SECRET_KEY as string | undefined;
  if (data.NODE_ENV === 'production') {
    if (data.DOCUMENT_RENDERER === 'fake') {
      throw new Error('Nieprawidłowa konfiguracja: atrapa silnika dokumentów nie działa w produkcji');
    }
    if (data.FILE_STORAGE === 'memory') {
      throw new Error('Nieprawidłowa konfiguracja: magazyn plików w pamięci nie działa w produkcji');
    }
    if (!s3Access || !s3Secret) {
      throw new Error('Nieprawidłowa konfiguracja: w produkcji wymagane są S3_ACCESS_KEY i S3_SECRET_KEY');
    }
  }
  const simulatorControl = data.SIMULATOR_CONTROL_ENABLED as boolean | undefined;
  return {
    ...data,
    SIMULATOR_CONTROL_ENABLED: simulatorControl ?? data.NODE_ENV === 'development',
    JWT_SECRET: jwtSecret ?? DEV_JWT_SECRET,
    TOTP_ENCRYPTION_KEY: totpKey ?? DEV_TOTP_KEY,
    S3_ACCESS_KEY: s3Access ?? DEV_S3_KEYS.access,
    S3_SECRET_KEY: s3Secret ?? DEV_S3_KEYS.secret,
  };
}

/**
 * Projekt nie obsługuje prawdziwych pieniędzy (ADR 0050): klucz `live` zatrzymuje start. Stripe wymaga
 * wszystkich trzech kluczy testowych, a atrapa nie działa w produkcji (ADR 0051).
 */
function checkPaymentConfig(data: ParsedEnv): void {
  const keys = [data.STRIPE_SECRET_KEY, data.STRIPE_PUBLISHABLE_KEY].filter(Boolean) as string[];
  if (keys.some((k) => /^(sk|pk|rk)_live_/.test(k))) {
    throw new Error('Nieprawidłowa konfiguracja: klucze Stripe w trybie live są niedozwolone, użyj kluczy testowych');
  }
  if (data.PAYMENT_PROVIDER === 'stripe') {
    if (!data.STRIPE_SECRET_KEY?.startsWith('sk_test_') || !data.STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')) {
      throw new Error('Nieprawidłowa konfiguracja: PAYMENT_PROVIDER=stripe wymaga kluczy sk_test_ i pk_test_');
    }
    if (!data.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
      throw new Error('Nieprawidłowa konfiguracja: PAYMENT_PROVIDER=stripe wymaga STRIPE_WEBHOOK_SECRET (whsec_)');
    }
  }
  if (data.PAYMENT_PROVIDER === 'fake' && data.NODE_ENV === 'production') {
    throw new Error('Nieprawidłowa konfiguracja: atrapa operatora płatności nie działa w produkcji');
  }
}

export const CONFIG = Symbol('CONFIG');
