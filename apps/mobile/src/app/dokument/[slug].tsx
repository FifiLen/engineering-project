import type { LegalDocumentView } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { MarkdownView } from '../../components/markdown';
import { Body, ErrorBox, Lead, Screen, Title, TopBar, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';

/** Obowiązująca wersja dokumentu z bazy (regulamin, polityka prywatności; ADR 0027), Markdown w profilu `document` (ADR 0063). */
export default function DocumentScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const theme = useTheme();
  const [doc, setDoc] = useState<LegalDocumentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<LegalDocumentView>(`/legal/${slug}`)
      .then(setDoc)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [slug]);
  return (
    <Screen>
      <TopBar onBack={() => router.back()} />
      {error && <ErrorBox message={error} />}
      {!doc && !error && <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />}
      {doc && (
        <>
          <Title size={28}>{doc.title}</Title>
          <Lead>{t('document.version', { version: doc.versionNo })}</Lead>
          <View style={{ marginTop: 24 }}>
            <MarkdownView source={doc.bodyMd} profile="document" gap={12} />
          </View>
          <Body muted style={{ marginTop: 24 }}>
            {''}
          </Body>
        </>
      )}
    </Screen>
  );
}
