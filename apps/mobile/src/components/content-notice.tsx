import { isAllowedHref, type PublicContentSection } from '@hulajnogi/shared';
import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import { useSection } from '../lib/content';
import { readSetting, saveSetting } from '../lib/storage';
import { Icon } from './icons';
import { InlineMarkdown } from './markdown';
import { glass, IconBadge } from './sheet';
import { useTheme } from './ui';

const DISMISSED_KEY = 'noticeDismissed';
/** Przycisk otwiera tylko adresy, które aplikacja umie otworzyć (jak odnośniki w Markdown); ścieżki strony pomija. */
const OPENABLE = /^(https:|mailto:|tel:)/i;

/**
 * Wersja komunikatu: skrót treści i przycisku (FNV-1a). Publiczna treść nie ma numeru wersji bloku, a skrót zmienia
 * się z każdą zmianą tekstu w panelu, więc zamknięty komunikat wraca po edycji, a nie po samym odświeżeniu treści.
 */
export function noticeVersion(notice: Pick<PublicContentSection, 'bodyMd' | 'buttonLabel' | 'buttonHref'>): string {
  const text = [notice.bodyMd ?? '', notice.buttonLabel ?? '', notice.buttonHref ?? ''].join('\u0000');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Komunikat do pokazania: opublikowana sekcja z treścią, niezamknięta w tej wersji; `null` w pozostałych przypadkach. */
export function useContentNotice() {
  const notice = useSection('mobile.notice');
  // `undefined`: pamięć jeszcze nieodczytana (bez mignięcia komunikatu zamkniętego wcześniej).
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void readSetting(DISMISSED_KEY).then((value) => {
      if (alive) setDismissed(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const body = notice?.bodyMd?.trim();
  if (!notice || !body || dismissed === undefined) return null;
  const version = noticeVersion(notice);
  if (dismissed === version) return null;
  return {
    notice,
    dismiss: () => {
      setDismissed(version);
      void saveSetting(DISMISSED_KEY, version);
    },
  };
}

/**
 * Komunikat z treści `mobile.notice` (makieta 31-mobile-tresci/komunikat, ADR 0062): szklana karta pod paskiem
 * wyszukiwania mapy z ikoną informacji, treścią inline z bazy i opcjonalnym przyciskiem tekstowym; ✕ chowa go dla
 * tej wersji treści.
 */
export function ContentNotice({ notice, onDismiss }: { notice: PublicContentSection; onDismiss: () => void }) {
  const theme = useTheme();
  const href = notice.buttonHref;
  const label = notice.buttonLabel?.trim();
  const openable = !!href && !!label && OPENABLE.test(href) && isAllowedHref(href);
  return (
    <View
      accessibilityRole="summary"
      style={[
        glass(theme),
        { borderRadius: 20, paddingVertical: 12, paddingLeft: 12, paddingRight: 8, flexDirection: 'row', gap: 12 },
      ]}
    >
      <IconBadge icon="info" tone="accent" size={32} iconSize={18} />
      <View style={{ flex: 1, minWidth: 0, gap: 6, paddingTop: 6 }}>
        <InlineMarkdown source={notice.bodyMd ?? ''} style={{ fontSize: 14, lineHeight: 20, color: theme.ink }} />
        {openable ? (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              if (isAllowedHref(href)) void Linking.openURL(href).catch(() => undefined);
            }}
            hitSlop={8}
            style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ fontSize: 14, lineHeight: 24, fontWeight: '600', color: theme.accentMap }}>{label}</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('map.notice.close')}
        onPress={onDismiss}
        hitSlop={6}
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="close" color={theme.muted} size={16} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}
