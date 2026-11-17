import type { MeResponse, NotificationPreferences, ProfileSummary } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ListGroup, ListRow, PageScreen, SectionLabel, Segmented, ToggleRow } from '../../components/list';
import { ErrorBox } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { THEME_MODES, usePreferences } from '../../lib/preferences';
import { useSession } from '../../lib/session';

/**
 * Ustawienia (makieta profil-ustawienia, decyzja D6): powiadomienia w bazie (`PATCH /me/notifications`),
 * „Promocje” to zgoda marketingowa (`PATCH /me`), motyw i strefy na mapie na urządzeniu. „Pobierz moje
 * dane” wejdzie w iteracji 7 (D8).
 */
export default function SettingsScreen() {
  const { me, setMe } = useSession();
  const { themeMode, setThemeMode, showZones, setShowZones } = usePreferences();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ProfileSummary>('/me/profile')
      .then((p) => setPrefs(p.notifications))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  async function savePrefs(next: NotificationPreferences) {
    const previous = prefs;
    setPrefs(next);
    setError(null);
    try {
      setPrefs(await api<NotificationPreferences>('/me/notifications', { method: 'PATCH', json: next }));
    } catch (e) {
      setPrefs(previous);
      setError(errorMessage(e));
    }
  }

  async function saveMarketing(marketing: boolean) {
    if (!me) return;
    setError(null);
    setMe({ ...me, marketingConsent: marketing });
    try {
      setMe(await api<MeResponse>('/me', { method: 'PATCH', json: { marketing } }));
    } catch (e) {
      setMe(me);
      setError(errorMessage(e));
    }
  }

  return (
    <PageScreen title={t('settings.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/profil'))}>
      {error && <ErrorBox message={error} />}
      <SectionLabel>{t('settings.notifications')}</SectionLabel>
      <ListGroup>
        <ToggleRow
          first
          label={t('settings.reservationEnd')}
          value={prefs?.reservationEnd ?? false}
          disabled={!prefs}
          onChange={(v) => prefs && void savePrefs({ ...prefs, reservationEnd: v })}
        />
        <ToggleRow
          label={t('settings.receipts')}
          value={prefs?.receipts ?? false}
          disabled={!prefs}
          onChange={(v) => prefs && void savePrefs({ ...prefs, receipts: v })}
        />
        <ToggleRow label={t('settings.promotions')} value={me?.marketingConsent ?? false} onChange={(v) => void saveMarketing(v)} />
      </ListGroup>
      <SectionLabel>{t('settings.appearance')}</SectionLabel>
      <ListGroup>
        <ListRow
          first
          label={t('settings.theme')}
          right={
            <Segmented
              value={themeMode}
              onChange={setThemeMode}
              options={THEME_MODES.map((mode) => ({ value: mode, label: t(`settings.themes.${mode}`) }))}
            />
          }
        />
        <ToggleRow label={t('settings.zones')} value={showZones} onChange={setShowZones} />
        <ListRow label={t('settings.language')} value={t('settings.languageValue')} />
      </ListGroup>
      <SectionLabel>{t('settings.account')}</SectionLabel>
      <ListGroup>
        <ListRow first label={t('settings.personal')} onPress={() => router.push('/profil/dane')} />
        <ListRow label={t('settings.delete')} danger chevron={false} onPress={() => router.push('/profil/usun')} />
      </ListGroup>
    </PageScreen>
  );
}
