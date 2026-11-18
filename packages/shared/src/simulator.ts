/**
 * Kontrakt sterowania symulatorem z panelu (ADR 0059). Źródło prawdy: docs/kontrakty/asyncapi-symulator.yaml 1.0.0,
 * osobno od kontraktu urządzeń (`mqtt.ts`). Publikować na `simulator/control` może tylko backend; symulator
 * odpowiada na `simulator/control/result` i publikuje stan na `simulator/status` (retained).
 */
import { z } from 'zod';
import { geoPointSchema } from './service.js';

export const SIMULATOR_CONTRACT_VERSION = '1.0.0';

export const simulatorTopics = {
  control: 'simulator/control',
  result: 'simulator/control/result',
  status: 'simulator/status',
} as const;

/** Polecenia scenariuszy (pytanie 10); na hulajnodze działa najwyżej jeden scenariusz. */
export const SIMULATOR_ACTIONS = [
  'disconnect',
  'restore',
  'silence',
  'unsilence',
  'drain',
  'goto',
  'enter_no_ride',
  'cancel',
] as const;
export type SimulatorAction = (typeof SIMULATOR_ACTIONS)[number];

/** Rozładowanie: liniowy spadek do `targetPct` w `durationS`, potem zwykłe rozładowanie. */
export const drainParamsSchema = z.object({
  targetPct: z.number().int().min(0).max(100).default(5),
  durationS: z.number().int().min(1).max(600).default(30),
});

export const gotoParamsSchema = z.union([
  z.object({ zoneId: z.uuid() }).strict(),
  z.object({ point: geoPointSchema }).strict(),
]);

const empty = z.object({}).strict().default({});

const scooterNumber = z.number().int().min(1).max(9999);

/** Warianty akcji z parametrami; `shape` to wspólne pola polecenia z panelu albo wiadomości MQTT. */
const actionVariants = <S extends z.ZodRawShape>(shape: S) =>
  [
    z.object({ ...shape, action: z.literal('disconnect'), params: empty }),
    z.object({ ...shape, action: z.literal('restore'), params: empty }),
    z.object({ ...shape, action: z.literal('silence'), params: empty }),
    z.object({ ...shape, action: z.literal('unsilence'), params: empty }),
    z.object({
      ...shape,
      action: z.literal('drain'),
      params: drainParamsSchema.default({ targetPct: 5, durationS: 30 }),
    }),
    z.object({ ...shape, action: z.literal('goto'), params: gotoParamsSchema }),
    z.object({ ...shape, action: z.literal('enter_no_ride'), params: z.object({ zoneId: z.uuid() }).strict() }),
    z.object({ ...shape, action: z.literal('cancel'), params: empty }),
  ] as const;

/** `POST /admin/simulator/commands` (`simulator.manage`): hulajnoga po numerze, akcja i parametry. */
export const simulatorCommandRequestSchema = z.discriminatedUnion('action', actionVariants({ scooter: scooterNumber }));
export type SimulatorCommandRequest = z.infer<typeof simulatorCommandRequestSchema>;

/** Wiadomość `simulator/control` (QoS 1, bez retained); po `expiresAt` symulator odrzuca polecenie (`EXPIRED`). */
export const simulatorControlSchema = z.discriminatedUnion(
  'action',
  actionVariants({
    commandId: z.uuid(),
    scooter: scooterNumber,
    issuedBy: z.uuid(),
    expiresAt: z.iso.datetime(),
  }),
);
export type SimulatorControl = z.infer<typeof simulatorControlSchema>;

export const SIMULATOR_RESULT_REASONS = [
  'SCENARIO_ACTIVE',
  'NO_SCENARIO',
  'SCOOTER_NOT_FOUND',
  'ZONE_NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'INVALID_PARAMS',
  'EXPIRED',
] as const;
export type SimulatorResultReason = (typeof SIMULATOR_RESULT_REASONS)[number];

/** Wynik `simulator/control/result` (QoS 1); drugi scenariusz na tej samej hulajnodze dostaje `SCENARIO_ACTIVE`. */
export const simulatorResultSchema = z.object({
  commandId: z.uuid(),
  ok: z.boolean(),
  reason: z.enum(SIMULATOR_RESULT_REASONS).optional(),
});
export type SimulatorResult = z.infer<typeof simulatorResultSchema>;

/** Scenariusze trwające na hulajnodze (akcje, które coś uruchamiają). */
export const SIMULATOR_SCENARIOS = ['disconnect', 'silence', 'drain', 'goto', 'enter_no_ride'] as const;
export type SimulatorScenarioKind = (typeof SIMULATOR_SCENARIOS)[number];

export const simulatorScenarioSchema = z.object({
  scooter: scooterNumber,
  kind: z.enum(SIMULATOR_SCENARIOS),
  startedAt: z.iso.datetime(),
  /** Postęp do panelu: bateria przy rozładowaniu, pozostały dystans przy jeździe, komendy bez potwierdzenia. */
  progress: z
    .object({
      batteryPct: z.number().min(0).max(100).optional(),
      targetPct: z.number().int().min(0).max(100).optional(),
      remainingS: z.number().min(0).optional(),
      remainingM: z.number().min(0).optional(),
      unackedCommands: z.number().int().min(0).optional(),
    })
    .default({}),
  target: z
    .object({ zoneId: z.uuid().optional(), code: z.string().optional(), point: geoPointSchema.optional() })
    .optional(),
});
export type SimulatorScenario = z.infer<typeof simulatorScenarioSchema>;

/**
 * Stan na `simulator/status` (retained). Last Will symulatora to `{ online: false }`. Pola od `updatedAt` dochodzą
 * w kontrakcie symulatora 1.0.0; symulator sprzed iteracji 6 ich nie wysyła.
 */
export const simulatorStatusSchema = z.discriminatedUnion('online', [
  z.object({ online: z.literal(false) }),
  z.object({
    online: z.literal(true),
    since: z.iso.datetime(),
    fleetSize: z.number().int().min(0),
    connected: z.number().int().min(0),
    riding: z.number().int().min(0),
    messagesPerSecond: z.number().min(0),
    ridesPerHour: z.number().min(0),
    updatedAt: z.iso.datetime().optional(),
    telemetryIntervalMs: z.number().int().positive().optional(),
    ridesStarted: z.number().int().min(0).optional(),
    commandsReceived: z.number().int().min(0).optional(),
    commandsUnacked: z.number().int().min(0).optional(),
    scenarios: z.array(simulatorScenarioSchema).default([]),
  }),
]);
export type SimulatorStatus = z.infer<typeof simulatorStatusSchema>;

/** Panel pokazuje „Symulator nie odpowiada” po 30 s bez stanu. */
export const SIMULATOR_STALE_AFTER_MS = 30_000;

/** Stan dla panelu (`GET /admin/simulator/status` i zdarzenie `simulator.status`): ostatni stan i chwila jego odbioru. */
export interface SimulatorStatusView {
  status: SimulatorStatus | null;
  receivedAt: string | null;
  enabled: boolean;
  /**
   * „Symulator nie odpowiada”: brak stanu albo ostatni stan starszy niż `SIMULATOR_STALE_AFTER_MS` (od `updatedAt`
   * z wiadomości, a bez niego od chwili odbioru w API). Panel liczy to też sam z `receivedAt`, bo bez stanu nie
   * przychodzi żadne zdarzenie.
   */
  stale: boolean;
}

/** Polecenie z dziennika audytu (`simulator.command`) z wynikiem z `simulator/control/result`, jeśli przyszedł. */
export interface SimulatorCommandView {
  commandId: string;
  at: string;
  staffId: string | null;
  staffName: string | null;
  action: SimulatorAction;
  scooter: number;
  params: Record<string, unknown>;
  expiresAt: string;
  /** `null`: wynik jeszcze nie przyszedł albo API zostało uruchomione ponownie (wyniki są tylko w pamięci API). */
  result: { ok: boolean; reason: SimulatorResultReason | null; at: string } | null;
}

/** `GET /admin/simulator/status`: stan i ostatnie polecenia („Ostatnie polecenia” w makiecie `symulator`). */
export interface SimulatorOverview extends SimulatorStatusView {
  commands: SimulatorCommandView[];
}

/** Odpowiedź `POST /admin/simulator/commands` (202): polecenie opublikowane, wynik przyjdzie zdarzeniem. */
export interface SimulatorCommandAccepted {
  commandId: string;
  expiresAt: string;
}

/** Czas na wykonanie polecenia przez symulator (`expiresAt`); później symulator odpowiada `EXPIRED`. */
export const SIMULATOR_COMMAND_TTL_MS = 30_000;
