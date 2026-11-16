import type { MeResponse } from '@hulajnogi/shared';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Body, Button, Checkbox, ErrorBox, Field, Lead, Screen, Title, TopBar } from '../components/ui';
import { t } from '../i18n';
import { api, errorMessage } from '../lib/api';
import { homeFor, useSession } from '../lib/session';

/**
 * Dokończenie rejestracji (makieta konto-dane): imię, e-mail, wiek z obowiązującego cennika i zgoda
 * marketingowa. Regulamin i politykę klient zaakceptował na ekranie numeru; przy pierwszym logowaniu
 * nowego numeru akceptuje je tutaj.
 */
export default function ProfileScreen() {
  const { me, setMe, termsAccepted, signOut } = useSession();
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [age, setAge] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [terms, setTerms] = useState(termsAccepted);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return <Redirect href="/witaj" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<MeResponse>('/me/registration', {
        method: 'POST',
        json: {
          name: name.trim(),
          email: email.trim() || null,
          ageConfirmed: age,
          marketing,
          acceptedVersionIds: me!.pendingDocuments.map((d) => d.versionId),
        },
      });
      setMe(updated);
      router.replace(updated.nextStep === 'READY' ? '/zasady' : homeFor(updated));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label={t('profile.submit')} onPress={() => void submit()} busy={busy} disabled={!name.trim() || !age || !terms} />}>
      <TopBar onBack={() => void signOut().then(() => router.replace('/witaj'))} step={{ current: 3, total: 3 }} />
      <Title>{t('profile.title')}</Title>
      <Lead>{t('profile.lead')}</Lead>
      <View style={{ gap: 12, marginTop: 28 }}>
        <Field label={t('profile.name')} value={name} onChangeText={setName} textContentType="givenName" autoComplete="name" autoFocus />
        <Field
          label={t('profile.email')}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          textContentType="emailAddress"
          autoComplete="email"
        />
      </View>
      <View style={{ gap: 16, marginTop: 24 }}>
        <Checkbox checked={age} onToggle={() => setAge(!age)} label={t('profile.age', { age: me.minUserAge ?? 18 })}>
          <Body>{t('profile.age', { age: me.minUserAge ?? 18 })}</Body>
        </Checkbox>
        {!termsAccepted && (
          <Checkbox checked={terms} onToggle={() => setTerms(!terms)} label={t('phone.acceptLabel')}>
            <Body>{t('profile.terms')}</Body>
          </Checkbox>
        )}
        <Checkbox checked={marketing} onToggle={() => setMarketing(!marketing)} label={t('profile.marketing')}>
          <Body>{t('profile.marketing')}</Body>
        </Checkbox>
      </View>
      {error && <ErrorBox message={error} />}
    </Screen>
  );
}
