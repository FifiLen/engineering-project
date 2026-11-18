import type { MeResponse, NotificationPreferences, ProfileSummary } from '@hulajnogi/shared';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { Icon } from '../../components/icons';
import { ListGroup, ListRow, PageScreen, SectionLabel, Segmented, ToggleRow } from '../../components/list';
import { ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { useNotifications } from '../../lib/notifications';
import { THEME_MODES, usePreferences } from '../../lib/preferences';
import { useSession } from '../../lib/session';

/**
 * Ustawienia (makiety profil-ustawienia, ustawienia-powiadomienia-wylaczone; decyzja D6, ADR 0058):
 * powiadomienia w bazie (`PATCH /me/notifications`), „Promocje” to zgoda marketingowa (`PATCH /me`), motyw
 * i strefy na mapie na urządzeniu. Gdy system nie pozwala na powiadomienia (stan sprawdzany przy otwarciu
 * i powrocie z tła), pasek ostrzeżenia z ustawieniami telefonu albo oknem zgody; preferencje zostają
 * edytowalne, bo są zapisane na koncie. „Pobierz moje dane” wejdzie w iteracji 7 (D8).
 */
export default function SettingsScreen() {
  const theme = useTheme();
  const { permission, refreshPermission, enable } = useNotifications();
  const { me, setMe } = useSession();
  const { themeMode, setThemeMode, showZones, setShowZones } = usePreferences();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => subscription.remove();
  }, [refreshPermission]);

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
      {Platform.OS !== 'web' && (permission === 'denied' || permission === 'undetermined') && (
        <View
          accessibilityRole="alert"
          style={{ borderRadius: 20, backgroundColor: theme.warningTint, padding: 16, flexDirection: 'row', gap: 14 }}
        >
          <Icon name="bellOff" color={theme.warning} size={22} strokeWidth={2} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.warning }}>{t('settings.pushOff.title')}</Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: theme.ink }}>{t('settings.pushOff.lead')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void (permission === 'denied' ? Linking.openSettings() : enable())}
              hitSlop={8}
              style={{ marginTop: 6, alignSelf: 'flex-start' }}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: theme.accent }}>
                {permission === 'denied' ? t('settings.pushOff.settings') : t('settings.pushOff.enable')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
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
      <Text style={{ fontSize: 13, lineHeight: 19, color: theme.muted, marginHorizontal: 4, marginTop: -12 }}>
        {t('settings.alwaysSent')}
      </Text>
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
