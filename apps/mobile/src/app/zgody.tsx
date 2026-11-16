import type { MeResponse } from '@hulajnogi/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Badge, Body, Button, Checkbox, ErrorBox, Group, Lead, Screen, Title, useTheme } from '../components/ui';
import { t } from '../i18n';
import { api, errorMessage } from '../lib/api';
import { homeFor, useSession } from '../lib/session';

/** Nowa wersja dokumentu (makieta konto-nowa-wersja): najważniejsze zmiany, pełna treść, akceptacja. */
export default function ConsentsScreen() {
  const theme = useTheme();
  const { me, setMe } = useSession();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return <Redirect href="/witaj" />;
  const docs = me.pendingDocuments;
  const summary = docs.map((d) => d.changeSummary).filter(Boolean).join(' ');
  const names = docs.map((d) => t('consents.docVersion', { title: d.title, version: d.versionNo })).join(', ');

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<MeResponse>('/me/consents', { method: 'POST', json: { acceptedVersionIds: docs.map((d) => d.versionId) } });
      setMe(updated);
      router.replace(homeFor(updated));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button label={t('consents.accept')} onPress={() => void accept()} busy={busy} disabled={!checked} />
          <Button label={t('consents.later')} kind="plain" onPress={() => router.replace('/konto')} />
          <Text style={{ textAlign: 'center', fontSize: 13, lineHeight: 19, color: theme.muted }}>{t('consents.laterHint')}</Text>
        </>
      }
    >
      <Badge tone="accent">
        <Text style={{ fontSize: 24, color: theme.accent }}>{t('consents.badge')}</Text>
      </Badge>
      <Title>{docs.length === 1 && docs[0]!.consentType === 'PRIVACY' ? t('consents.titlePrivacy') : t('consents.title')}</Title>
      <Lead>{t('consents.lead')}</Lead>
      {summary ? (
        <View style={{ marginTop: 28 }}>
          <Group>
            <View style={{ padding: 16, gap: 6 }}>
              <Text style={{ fontSize: 13, color: theme.muted }}>{t('consents.summary')}</Text>
              <Body>{summary}</Body>
            </View>
          </Group>
        </View>
      ) : null}
      <View style={{ marginTop: 12 }}>
        <Group>
          {docs.map((d, i) => (
            <Pressable
              key={d.versionId}
              accessibilityRole="link"
              onPress={() => router.push({ pathname: '/dokument/[slug]', params: { slug: d.slug } })}
              style={{ minHeight: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderTopWidth: i ? 1 : 0, borderColor: theme.line }}
            >
              <Text style={{ flex: 1, fontSize: 16, color: theme.ink }}>{t('consents.docVersion', { title: d.title, version: d.versionNo })}</Text>
              <Text style={{ fontSize: 20, color: theme.muted }}>{t('common.chevron')}</Text>
            </Pressable>
          ))}
        </Group>
      </View>
      <View style={{ marginTop: 24 }}>
        <Checkbox checked={checked} onToggle={() => setChecked(!checked)} label={t('consents.checkbox', { documents: names })}>
          <Body>{t('consents.checkbox', { documents: names })}</Body>
        </Checkbox>
      </View>
      {error && <ErrorBox message={error} />}
    </Screen>
  );
}
