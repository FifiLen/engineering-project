import { parseScooterCode, type CustomerScooterView } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Text, TextInput, View } from 'react-native';
import { Icon } from '../components/icons';
import { metersBetween } from '../components/map/map-layers';
import { ScooterRender } from '../components/scooter';
import { Button, ErrorBox, Lead, Screen, Title, TopBar, useTheme } from '../components/ui';
import { t } from '../i18n';
import { ApiError, api, errorMessage } from '../lib/api';
import { distance, scooterNo } from '../lib/format';
import { useLocation } from '../lib/location';
import { radius } from '../theme/tokens';

const LOOKUP_DELAY_MS = 350;

/**
 * Wpisanie numeru hulajnogi (makieta skan-numer, ADR 0041): równorzędna droga do skanu, jedyna w
 * przeglądarce i w symulatorze iOS. Numer czyta ta sama funkcja co kod QR, a podgląd pokazuje hulajnogę,
 * zanim klient przejdzie dalej.
 */
export default function NumberScreen() {
  const theme = useTheme();
  const { position } = useLocation();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(true);
  // Wynik wyszukiwania dla konkretnego numeru; po zmianie numeru stary wynik przestaje obowiązywać.
  const [result, setResult] = useState<{ number: number; scooter?: CustomerScooterView; error?: string } | null>(null);
  const number = parseScooterCode(text);
  const current = number !== null && result?.number === number ? result : null;
  const scooter = current?.scooter ?? null;
  const error = current?.error ?? null;
  const loading = number !== null && !current;

  useEffect(() => {
    if (number === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api<CustomerScooterView>(`/scooters/by-number/${number}`)
        .then((s) => !cancelled && setResult({ number, scooter: s }))
        .catch((e: unknown) => {
          if (cancelled) return;
          const message = e instanceof ApiError && e.code === 'NOT_FOUND' ? t('number.notFound', { number: scooterNo(number) }) : errorMessage(e);
          setResult({ number, error: message });
        });
    }, LOOKUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [number]);

  const away =
    scooter && position && scooter.lat !== null && scooter.lon !== null
      ? metersBetween(position, { lat: scooter.lat, lon: scooter.lon })
      : null;
  const next = () => scooter && router.replace({ pathname: '/hulajnoga/[number]', params: { number: String(scooter.number) } });

  return (
    <Screen
      footer={
        <>
          <Button label={t('number.next')} onPress={next} disabled={!scooter} />
          <Button label={t('number.scan')} kind="plain" onPress={() => router.replace('/skan')} />
        </>
      }
    >
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/mapa'))} />
      <Title>{t('number.title')}</Title>
      <Lead>{t('number.lead')}</Lead>
      <View
        style={{
          marginTop: 28,
          height: 60,
          borderRadius: radius.field,
          paddingHorizontal: 16,
          justifyContent: 'center',
          backgroundColor: theme.surface,
          borderColor: focused ? theme.accent : theme.line,
          borderWidth: focused ? 1.5 : 1,
        }}
      >
        <Text style={{ fontSize: 12, color: theme.muted }}>{t('number.label')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 }}>
          <Text style={{ fontSize: 17, fontWeight: '500', color: theme.muted }}>{t('number.hash')}</Text>
          <TextInput
            accessibilityLabel={t('number.label')}
            autoFocus
            value={text}
            onChangeText={(v) => setText(v.replace(/\D/g, '').slice(0, 4))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSubmitEditing={next}
            keyboardType="number-pad"
            maxLength={4}
            style={{
              flex: 1,
              fontSize: 17,
              fontWeight: '500',
              padding: 0,
              color: theme.ink,
              ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
            }}
          />
        </View>
      </View>
      {loading && !scooter && <ActivityIndicator style={{ marginTop: 20 }} color={theme.accent} />}
      {scooter && (
        <View
          style={{
            marginTop: 12,
            borderRadius: radius.list,
            borderWidth: 1,
            borderColor: theme.line,
            backgroundColor: theme.surface,
            paddingVertical: 12,
            paddingHorizontal: 16,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.line, alignItems: 'center', justifyContent: 'center' }}>
            <ScooterRender variant={scooter.variant} side style={{ width: 40, height: 40 }} label={t('variants.render', { variant: t(`variants.${scooter.variant}`) })} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>{t('number.preview', { number: scooterNo(scooter.number) })}</Text>
            {scooter.batteryPct !== null && (
              <Text style={{ fontSize: 14, color: theme.muted }}>
                {away !== null ? t('number.details', { battery: scooter.batteryPct, distance: distance(away) }) : t('number.battery', { battery: scooter.batteryPct })}
              </Text>
            )}
          </View>
          {scooter.available || scooter.reservedByMe ? (
            <Icon name="check" color={theme.accentMap} strokeWidth={2.4} />
          ) : (
            <Icon name="alert" color={theme.warning} />
          )}
        </View>
      )}
      {error && <ErrorBox message={error} />}
    </Screen>
  );
}
