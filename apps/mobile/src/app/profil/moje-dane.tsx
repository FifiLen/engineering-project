import {
  DATA_EXPORT_LIMIT,
  DATA_EXPORT_POLL_INTERVAL_MS,
  DATA_EXPORT_TTL_MS,
  type DataExportLatest,
  type DataExportLimitDetails,
  type DataExportView,
} from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ActionButton, CardBody, ContentRow, Numbers, StatusCard } from '../../components/document';
import type { IconName } from '../../components/icons';
import { ListGroup, PageScreen, SectionLabel } from '../../components/list';
import { Note } from '../../components/payment';
import { ErrorBox, Lead, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { ApiError, api, errorMessage } from '../../lib/api';
import { useDataExportEvents } from '../../lib/documents';
import { downloadToCache, OPENS_IN_BROWSER, openInBrowser, removeCached, shareFile } from '../../lib/download';
import { dateNumeric, dayAt, dayFrom, fileSize } from '../../lib/format';

/** Rozdziały pliku z planszy (sekcje `dataExportSchema`, ADR 0069). */
const SECTIONS: { key: string; icon: IconName }[] = [
  { key: 'profile', icon: 'person' },
  { key: 'rentals', icon: 'scooter' },
  { key: 'wallet', icon: 'wallet' },
  { key: 'tickets', icon: 'wrench' },
  { key: 'notifications', icon: 'bell' },
];

const TTL_DAYS = Math.round(DATA_EXPORT_TTL_MS / (24 * 60 * 60_000));
/** Adres z podpisem żyje 10 min; z zapasem pobieramy nowy przed pobraniem pliku. */
const URL_MARGIN_MS = 30_000;

const inProgress = (exp: DataExportView | null | undefined) => exp?.state === 'QUEUED' || exp?.state === 'RUNNING';

/**
 * „Pobierz moje dane” (ADR 0069, plansze moje-dane, moje-dane-przygotowanie, moje-dane-gotowe):
 * - stan z `GET /me/data-exports/latest` (ostatnie zlecenie i `nextAllowedAt`), zmiana na żywo po
 *   `data-export.ready`, a w toku także odpytywanie co [5] s;
 * - „Przygotuj plik” = `POST /me/data-exports`; `429 DATA_EXPORT_LIMIT` daje czas następnego zlecenia;
 * - gotowy plik: aplikacja natywna pobiera go do pamięci podręcznej, otwiera arkusz udostępniania i po nim usuwa
 *   kopię (dane osobowe); wersja web otwiera adres w nowej karcie (plik z `Content-Disposition: attachment`);
 * - nieudane zlecenie nie liczy się do limitu, więc przycisk wraca; wygasły plik ma kartę z datą ważności.
 */
export default function DataExportScreen() {
  const theme = useTheme();
  const [latest, setLatest] = useState<DataExportLatest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(
    (): Promise<DataExportLatest | null> =>
      api<DataExportLatest>('/me/data-exports/latest').then(
        (next) => {
          if (alive.current) {
            setLatest(next);
            setNow(Date.now());
          }
          return next;
        },
        (e: unknown) => {
          if (alive.current) setError(errorMessage(e));
          return null;
        },
      ),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useDataExportEvents(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const exp = latest?.export ?? null;
  const waiting = inProgress(exp);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), DATA_EXPORT_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  // Po upływie limitu przycisk staje się aktywny bez wychodzenia z ekranu.
  const nextAllowedAt = latest?.nextAllowedAt ?? null;
  useEffect(() => {
    if (!nextAllowedAt) return;
    const delay = Date.parse(nextAllowedAt) - Date.now();
    if (delay <= 0 || delay > 24 * 60 * 60_000) return;
    const timer = setTimeout(() => void load(), delay + 1000);
    return () => clearTimeout(timer);
  }, [nextAllowedAt, load]);

  async function request() {
    setError(null);
    setRequesting(true);
    try {
      const view = await api<DataExportView>('/me/data-exports', { method: 'POST' });
      setLatest((prev) => ({ export: view, nextAllowedAt: prev?.nextAllowedAt ?? null }));
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === DATA_EXPORT_LIMIT) {
        const details = e.details as Partial<DataExportLimitDetails> | undefined;
        setLatest((prev) => ({ export: prev?.export ?? null, nextAllowedAt: details?.nextAllowedAt ?? null }));
        await load();
      } else if (e instanceof ApiError && e.code === 'DATA_EXPORT_IN_PROGRESS') {
        await load();
      } else {
        setError(errorMessage(e));
      }
    } finally {
      if (alive.current) setRequesting(false);
    }
  }

  async function share() {
    if (!exp?.file) return;
    setError(null);
    // Adres z podpisem sprzed kilku minut mógł wygasnąć: wtedy najpierw świeży widok.
    let file: DataExportView['file'] = exp.file;
    if (Date.parse(file.urlExpiresAt) - Date.now() < URL_MARGIN_MS) file = (await load())?.export?.file ?? null;
    if (!file) return;
    if (OPENS_IN_BROWSER) {
      openInBrowser(file.url, { attachment: true });
      return;
    }
    setSharing(true);
    try {
      const saved = await downloadToCache(file.url, file.fileName);
      try {
        await shareFile(saved, 'json', t('dataExport.shareTitle'));
      } finally {
        removeCached(saved);
      }
    } catch {
      if (alive.current) setError(t('dataExport.shareFailed'));
    } finally {
      if (alive.current) setSharing(false);
    }
  }

  const blockedUntil = nextAllowedAt && Date.parse(nextAllowedAt) > now ? nextAllowedAt : null;
  const ready = exp?.state === 'SUCCEEDED' && !!exp.file;
  const canRequest = !!latest && !waiting && !blockedUntil;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profil/ustawienia'));

  const footer = latest ? (
    <>
      <ActionButton
        label={ready ? t('dataExport.requestNew') : t('dataExport.request')}
        busy={requesting}
        disabled={!canRequest}
        onPress={() => void request()}
      />
      {blockedUntil && (
        <Text style={{ fontSize: 13, color: theme.muted, textAlign: 'center' }}>
          <Numbers>
            {t(ready ? 'dataExport.nextAfterReady' : 'dataExport.nextAfterRequest', { when: dayFrom(blockedUntil) })}
          </Numbers>
        </Text>
      )}
    </>
  ) : undefined;

  return (
    <PageScreen title={t('dataExport.title')} onBack={back} footer={footer}>
      {error && <ErrorBox message={error} />}
      {!latest ? (
        !error && <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />
      ) : (
        <>
          {waiting && exp ? (
            <StatusCard spinner title={t('dataExport.preparingTitle')}>
              <CardBody>
                <Numbers>{t('dataExport.preparingLead', { when: dayAt(exp.requestedAt) })}</Numbers>
              </CardBody>
            </StatusCard>
          ) : ready && exp?.file ? (
            <StatusCard
              icon="file"
              title={exp.file.fileName}
              footer={
                <ActionButton icon="share" label={t('dataExport.share')} busy={sharing} onPress={() => void share()} />
              }
            >
              <Text style={{ fontSize: 13, color: theme.muted }}>
                <Numbers>
                  {t('dataExport.fileMeta', {
                    size: exp.sizeBytes !== null ? fileSize(exp.sizeBytes) : '',
                    date: exp.expiresAt ? dateNumeric(exp.expiresAt) : '',
                  })}
                </Numbers>
              </Text>
            </StatusCard>
          ) : exp?.state === 'FAILED' ? (
            <StatusCard icon="alert" tone="danger" title={t('dataExport.failedTitle')}>
              {t('dataExport.failedLead')}
            </StatusCard>
          ) : exp?.state === 'EXPIRED' && exp.expiresAt ? (
            <StatusCard
              icon="file"
              tone="neutral"
              title={t('dataExport.expiredTitle', { date: dateNumeric(exp.expiresAt) })}
            >
              {t('dataExport.expiredLead', { days: TTL_DAYS })}
            </StatusCard>
          ) : (
            <View style={{ marginHorizontal: 4 }}>
              <Lead>{t('dataExport.lead')}</Lead>
            </View>
          )}
          <SectionLabel>{t('dataExport.contents')}</SectionLabel>
          <ListGroup>
            {SECTIONS.map((section, i) => (
              <ContentRow
                key={section.key}
                first={i === 0}
                icon={section.icon}
                label={t.dynamic(`dataExport.sections.${section.key}`)}
              />
            ))}
          </ListGroup>
          {!waiting && !ready && (
            <Note style={{ marginHorizontal: 4, marginTop: -6 }}>{t('dataExport.note', { days: TTL_DAYS })}</Note>
          )}
        </>
      )}
    </PageScreen>
  );
}
