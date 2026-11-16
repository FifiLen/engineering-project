import type { LegalDocumentView } from '@hulajnogi/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { sections } from '../components/markdown';
import { Button, Lead, Screen, Title, TopBar, useTheme } from '../components/ui';
import { t } from '../i18n';
import { api } from '../lib/api';

/** Zasady przed pierwszą jazdą (makieta konto-zasady); treść z dokumentu `zasady-jazdy` w bazie (ADR 0027). */
export default function RulesScreen() {
  const theme = useTheme();
  const [doc, setDoc] = useState<LegalDocumentView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<LegalDocumentView>('/legal/zasady-jazdy')
      .then(setDoc)
      .catch(() => setFailed(true));
  }, []);
  const done = () => router.replace('/konto');

  return (
    <Screen footer={<Button label={t('rules.understood')} onPress={done} />}>
      <TopBar onBack={done} />
      <Title>{doc?.title ?? t('rules.title')}</Title>
      <Lead>{t('rules.lead')}</Lead>
      {!doc && !failed && <ActivityIndicator style={{ marginTop: 32 }} color={theme.accent} />}
      <View style={{ gap: 24, marginTop: 32 }}>
        {doc &&
          sections(doc.bodyMd).map((s, i) => (
            <View key={s.title} style={{ flexDirection: 'row', gap: 16 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.line, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, gap: 4, paddingTop: 2 }}>
                <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{s.title}</Text>
                <Text style={{ fontSize: 15, lineHeight: 22, color: theme.muted }}>{s.body.join(' ')}</Text>
              </View>
            </View>
          ))}
      </View>
    </Screen>
  );
}
