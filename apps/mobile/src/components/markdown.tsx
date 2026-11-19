/**
 * Markdown z bazy (ADR 0063): drzewo węzłów ze wspólnego parsera `parseMarkdown` z `@hulajnogi/shared` złożone
 * z zagnieżdżonych `Text` (bez HTML i bez WebView). Profil pola pochodzi z rejestru sekcji: `inline` (hero,
 * elementy list), `faq` (odpowiedzi, Pomoc), `document` (dokumenty prawne). Wiersz z błędem parser pomija.
 *
 * Odnośnik otwiera `Linking.openURL` po ponownym sprawdzeniu schematu (`isAllowedHref`). Aplikacja otwiera tylko
 * `https:`, `mailto:` i `tel:`; ścieżka strony (`/regulamin`) i kotwica (`#…`) zostają tekstem, bo aplikacja nie
 * zna adresu strony promocyjnej.
 */
import {
  isAllowedHref,
  parseMarkdown,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownProfile,
} from '@hulajnogi/shared';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Linking, Text, View, type TextStyle } from 'react-native';
import { useTheme } from './ui';

const OPENABLE = /^(https:|mailto:|tel:)/i;

function Inline({ nodes, linkColor }: { nodes: readonly MarkdownInline[]; linkColor: string }): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.value}</Fragment>;
      case 'strong':
        return (
          <Text key={i} style={{ fontWeight: '600' }}>
            <Inline nodes={node.children} linkColor={linkColor} />
          </Text>
        );
      case 'emphasis':
        return (
          <Text key={i} style={{ fontStyle: 'italic' }}>
            <Inline nodes={node.children} linkColor={linkColor} />
          </Text>
        );
      case 'link': {
        const href = node.href;
        if (!OPENABLE.test(href) || !isAllowedHref(href))
          return <Inline key={i} nodes={node.children} linkColor={linkColor} />;
        return (
          <Text
            key={i}
            accessibilityRole="link"
            onPress={() => {
              if (isAllowedHref(href)) void Linking.openURL(href).catch(() => undefined);
            }}
            style={{ color: linkColor, textDecorationLine: 'underline' }}
          >
            <Inline nodes={node.children} linkColor={linkColor} />
          </Text>
        );
      }
    }
  });
}

function Block({ block, text, linkColor }: { block: MarkdownBlock; text: TextStyle; linkColor: string }) {
  const theme = useTheme();
  switch (block.type) {
    case 'heading':
      return (
        <Text
          accessibilityRole="header"
          style={{
            fontSize: block.level === 2 ? 17 : 16,
            lineHeight: 24,
            fontWeight: '600',
            color: theme.ink,
            marginTop: 6,
          }}
        >
          <Inline nodes={block.children} linkColor={linkColor} />
        </Text>
      );
    case 'paragraph':
      return (
        <Text style={text}>
          <Inline nodes={block.children} linkColor={linkColor} />
        </Text>
      );
    case 'list':
      return (
        <View style={{ gap: 4 }}>
          {block.items.map((item, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={[text, { minWidth: block.ordered ? 18 : 10 }]}>{block.ordered ? `${i + 1}.` : '•'}</Text>
              <Text style={[text, { flex: 1 }]}>
                <Inline nodes={item} linkColor={linkColor} />
              </Text>
            </View>
          ))}
        </View>
      );
  }
}

/** Treść w Markdown; `style` to krój akapitu (rozmiar, interlinia, kolor), a odstęp między blokami `gap`. */
export function MarkdownView({
  source,
  profile,
  style,
  gap = 8,
}: {
  source: string;
  profile: MarkdownProfile;
  style?: TextStyle;
  gap?: number;
}) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(source, profile).blocks, [source, profile]);
  const text: TextStyle = { fontSize: 15, lineHeight: 22, color: theme.ink, ...style };
  return (
    <View style={{ gap }}>
      {blocks.map((block, i) => (
        <Block key={i} block={block} text={text} linkColor={theme.accentMap} />
      ))}
    </View>
  );
}

/** Tekst bez akapitów (profil `inline` w jednym `Text`): tytuł i wstęp ekranu startowego, opis zasady. */
export function InlineMarkdown({ source, style }: { source: string; style: TextStyle }) {
  const theme = useTheme();
  const blocks = useMemo(() => parseMarkdown(source, 'inline').blocks, [source]);
  return (
    <Text style={style}>
      {blocks.map((block, i) =>
        block.type === 'paragraph' ? (
          <Fragment key={i}>
            {i ? '\n' : null}
            <Inline nodes={block.children} linkColor={theme.accentMap} />
          </Fragment>
        ) : null,
      )}
    </Text>
  );
}
