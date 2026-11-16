import { Fragment, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from './ui';

/** Sekcje dokumentu: nagłówek `##` i tekst pod nim (zasady jazdy, regulamin z API, ADR 0027). */
export function sections(markdown: string): { title: string; body: string[] }[] {
  const result: { title: string; body: string[] }[] = [];
  for (const raw of markdown.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) result.push({ title: line.replace(/^#+\s*/, ''), body: [] });
    else if (result.length) result[result.length - 1]!.body.push(line);
    else result.push({ title: '', body: [line] });
  }
  return result;
}

function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <Text key={i} style={{ fontWeight: '600' }}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Prosty podgląd dokumentu prawnego: nagłówki, akapity i listy. */
export function Markdown({ source }: { source: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 18 }}>
      {sections(source).map((s, i) => (
        <View key={i} style={{ gap: 8 }}>
          {s.title ? <Text style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>{s.title}</Text> : null}
          {s.body.map((line, k) => (
            <Text key={k} style={{ fontSize: 15, lineHeight: 22, color: theme.ink }}>
              {inline(line)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}
