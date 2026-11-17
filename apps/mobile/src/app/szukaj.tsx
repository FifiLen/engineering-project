import type { PlaceResult, PlaceSearchResponse } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../components/icons';
import { metersBetween, type MapPoint } from '../components/map/map-layers';
import { IconBadge } from '../components/sheet';
import { Button, useTheme } from '../components/ui';
import { t } from '../i18n';
import { api } from '../lib/api';
import { distance } from '../lib/format';
import { useLocation } from '../lib/location';
import { useMapIntent, type Place } from '../lib/map-intent';

/** Zapytanie po 300 ms bez pisania i od 3 znaków (ADR 0045). */
const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

type Result = { query: string; places: PlaceResult[] } | { query: string; failed: true };

/**
 * „Dokąd jedziesz?” (makiety mapa-szukaj bez „Zapisane” według D4, szukaj-brak-wynikow z wariantem
 * błędu usługi). Miejsca z `GET /places/search` (Photon za API, obszar działania z zapasem 1 km);
 * „Ostatnio wyszukiwane” są tylko na urządzeniu. Wybór miejsca wraca na mapę z celem (szukaj-wynik).
 */
export default function SearchScreen() {
  const theme = useTheme();
  const { position } = useLocation();
  const { recent, remember, clearRecent, setDestination } = useMapIntent();
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const positionRef = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  });

  const query = text.trim().replace(/\s+/g, ' ');
  const active = query.length >= MIN_CHARS;
  const current = active && result?.query === query ? result : null;
  const loading = active && !current;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const from = positionRef.current;
      const near = from ? `&lat=${from.lat.toFixed(5)}&lon=${from.lon.toFixed(5)}` : '';
      api<PlaceSearchResponse>(`/places/search?q=${encodeURIComponent(query)}${near}`)
        .then((res) => !cancelled && setResult({ query, places: res.places }))
        .catch(() => !cancelled && setResult({ query, failed: true }));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, query, attempt]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/mapa'));
  const choose = (place: Place) => {
    remember(place);
    setDestination(place);
    close();
  };

  const failed = !!current && 'failed' in current;
  const places = current && !('failed' in current) ? current.places : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={styles.page}>
        <View style={styles.bar}>
          <View style={[styles.field, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
            <Icon name="search" color={theme.muted} size={20} />
            <TextInput
              autoFocus
              value={text}
              onChangeText={setText}
              accessibilityLabel={t('search.label')}
              placeholder={t('search.label')}
              placeholderTextColor={theme.muted}
              returnKeyType="search"
              autoCorrect={false}
              style={[styles.input, { color: theme.ink }]}
            />
            {text ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('search.clear')}
                onPress={() => setText('')}
                hitSlop={6}
                style={styles.clear}
              >
                <Icon name="close" color={theme.muted} size={18} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" onPress={close} hitSlop={6} style={styles.cancel}>
            <Text style={[styles.link16, { color: theme.accent }]}>{t('search.cancel')}</Text>
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          {loading && (
            <View accessible accessibilityLabel={t('search.loading')} style={{ paddingVertical: 28 }}>
              <ActivityIndicator color={theme.accent} />
            </View>
          )}

          {places && places.length > 0 && (
            <>
              <Text style={[styles.section, { color: theme.muted, marginTop: 28 }]}>{t('search.results')}</Text>
              <View style={{ marginTop: 4 }}>
                {places.map((p) => (
                  <PlaceRow
                    key={p.id}
                    icon="pin"
                    title={p.name}
                    subtitle={withDistance(p.description, p.distanceM ?? awayFrom(position, p))}
                    onPress={() => choose(p)}
                  />
                ))}
              </View>
            </>
          )}

          {(failed || (places && places.length === 0)) && (
            <View style={styles.empty}>
              {failed ? (
                <IconBadge icon="cloudAlert" tone="warning" size={56} iconSize={24} />
              ) : (
                <IconBadge icon="searchEmpty" tone="neutral" size={56} iconSize={24} />
              )}
              <Text accessibilityRole="header" style={[styles.emptyTitle, { color: theme.ink }]}>
                {failed ? t('search.error.title') : t('search.empty.title')}
              </Text>
              <Text style={[styles.emptyLead, { color: theme.muted }]}>
                {failed ? t('search.error.lead') : t('search.empty.lead', { brand: t('brand') })}
              </Text>
              {failed && (
                <Button
                  label={t('search.error.retry')}
                  kind="secondary"
                  onPress={() => {
                    setResult(null);
                    setAttempt((n) => n + 1);
                  }}
                  style={{ height: 44, marginTop: 18, paddingHorizontal: 22, width: 'auto' }}
                />
              )}
            </View>
          )}

          {recent.length > 0 && !(places && places.length > 0) && !loading && (
            <>
              <View style={[styles.recentHeader, { marginTop: active ? 40 : 20 }]}>
                <Text style={[styles.section, { color: theme.muted }]}>{t('search.recent')}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={clearRecent}
                  hitSlop={6}
                  style={{ height: 44, justifyContent: 'center' }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '500', color: theme.accent }}>
                    {t('search.recentClear')}
                  </Text>
                </Pressable>
              </View>
              {recent.map((p) => (
                <PlaceRow
                  key={p.id}
                  icon="clock"
                  title={p.name}
                  subtitle={withDistance(p.description, awayFrom(position, p))}
                  onPress={() => choose(p)}
                />
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const awayFrom = (from: MapPoint | null, p: MapPoint): number | null => (from ? metersBetween(from, p) : null);

/** „Centrum, 2,1 km”; bez opisu sama odległość, bez lokalizacji sam opis. */
function withDistance(description: string | null, meters: number | null): string {
  if (description && meters !== null) return t('search.withDistance', { description, distance: distance(meters) });
  return description ?? (meters !== null ? distance(meters) : '');
}

function PlaceRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: theme.line }]}>
        <Icon name={icon} color={theme.ink} size={20} />
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ fontSize: 14, color: theme.muted }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 20, paddingTop: 20 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  field: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 16,
    paddingRight: 6,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    height: 48,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  clear: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  cancel: { height: 44, justifyContent: 'center', paddingHorizontal: 4 },
  link16: { fontSize: 16, fontWeight: '500' },
  section: { fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', marginTop: 44, paddingHorizontal: 8 },
  emptyTitle: { marginTop: 18, fontSize: 22, fontWeight: '600', letterSpacing: -0.4, textAlign: 'center' },
  emptyLead: { marginTop: 8, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  recentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1 },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
