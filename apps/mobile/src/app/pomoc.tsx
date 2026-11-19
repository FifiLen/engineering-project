import { ticketLabel, type CustomerTicketListItem, type PublicFaqCategory } from '@hulajnogi/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '../components/icons';
import { ListGroup, PageScreen, SectionLabel } from '../components/list';
import { MarkdownView } from '../components/markdown';
import { ContentUnavailable } from '../components/offline';
import { useTheme } from '../components/ui';
import { t } from '../i18n';
import { api } from '../lib/api';
import { mailtoHref, telHref, useContent } from '../lib/content';
import { dateNumeric, timeOnly } from '../lib/format';
import { useSession } from '../lib/session';
import { useTicketEvents } from '../lib/tickets';

/**
 * Pomoc (makiety pomoc, pomoc-offline; ADR 0062): „Moje zgłoszenia” z kropką nowej odpowiedzi, FAQ aplikacji po
 * kategoriach (API podaje tylko opublikowane pytania z `showInApp`), kilka pytań otwartych naraz, kontakt z danych
 * firmy. Bez sieci treść z pamięci telefonu z czasem ostatniego pobrania, a „Moje zgłoszenia” są nieaktywne.
 */
export default function HelpScreen() {
  const theme = useTheme();
  const { status, content, fetchedAt, failure, refresh } = useContent();
  const { me } = useSession();
  const [tickets, setTickets] = useState<CustomerTicketListItem[] | null>(null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const offline = failure === 'network';

  const loadTickets = useCallback(() => {
    if (!me) return;
    api<CustomerTicketListItem[]>('/me/tickets')
      .then(setTickets)
      .catch(() => undefined);
  }, [me]);
  // Wejście na ekran sprawdza treści (stan sieci) i odpowiedzi w zgłoszeniach.
  useFocusEffect(
    useCallback(() => {
      void refresh();
      loadTickets();
    }, [refresh, loadTickets]),
  );
  useTicketEvents(loadTickets);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/profil'));
  if (status === 'unavailable') return <ContentUnavailable failure={failure} onRetry={() => void refresh()} />;

  const help = content?.sections['mobile.help'] ?? null;
  const company = content?.company ?? null;
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <PageScreen title={help?.title ?? t('help.title')} onBack={back}>
      {!content ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />
      ) : (
        <>
          {offline && fetchedAt ? <OfflineBar fetchedAt={fetchedAt} /> : null}
          {me ? <TicketsRow offline={offline} tickets={tickets} /> : null}
          {help?.bodyMd ? (
            // Wstęp z sekcji `mobile.help` (makieta go nie ma): pod „Moimi zgłoszeniami”, nad FAQ.
            <View style={{ marginHorizontal: 4 }}>
              <MarkdownView
                source={help.bodyMd}
                profile="faq"
                style={{ fontSize: 15, lineHeight: 22, color: theme.muted }}
              />
            </View>
          ) : null}
          {content.faq.map((category) => (
            <FaqCategory key={category.id} category={category} open={open} onToggle={toggle} />
          ))}
          {company ? (
            <>
              <SectionLabel>{t('help.contact.title')}</SectionLabel>
              <ListGroup>
                <ContactRow
                  first
                  icon="call"
                  label={t('help.contact.call')}
                  value={company.supportPhone}
                  href={telHref(company.supportPhone)}
                />
                <ContactRow
                  icon="mail"
                  label={t('help.contact.write')}
                  value={company.supportEmail}
                  href={mailtoHref(company.supportEmail)}
                />
              </ListGroup>
              <View style={styles.note}>
                <Icon name="clock" color={theme.muted} size={16} />
                <Text style={[styles.noteText, { color: theme.muted }]}>
                  {t('help.contact.hours', { hours: company.supportHours })}
                </Text>
              </View>
            </>
          ) : null}
        </>
      )}
    </PageScreen>
  );
}

/** Pasek „Brak połączenia z internetem” z czasem ostatniego udanego pobrania treści. */
function OfflineBar({ fetchedAt }: { fetchedAt: string }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.offline, { backgroundColor: theme.line }]}>
      <Icon name="wifiOff" color={theme.ink} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: theme.ink }}>{t('help.offline.title')}</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: theme.ink }}>
          {t('help.offline.lead')}
          <Text style={{ fontWeight: '500' }}>
            {t('help.offline.updated', { date: dateNumeric(fetchedAt), time: timeOnly(fetchedAt) })}
          </Text>
        </Text>
      </View>
    </View>
  );
}

/** „Moje zgłoszenia” na górze: kropka i numer przy nowej odpowiedzi; bez sieci nieaktywne. */
function TicketsRow({ offline, tickets }: { offline: boolean; tickets: CustomerTicketListItem[] | null }) {
  const theme = useTheme();
  const unread = (tickets ?? []).filter((ticket) => ticket.hasUnreadReply);
  const subtitle = offline
    ? t('help.tickets.offline')
    : unread.length === 1
      ? t('help.tickets.newReply', { ticket: ticketLabel(unread[0]!.number) })
      : unread.length > 1
        ? t('help.tickets.newReplies', { count: unread.length })
        : null;
  const disabled = theme.scheme === 'dark' ? theme.checkbox : '#A3A6AD';
  return (
    <ListGroup>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: offline }}
        accessibilityLabel={[t('help.tickets.title'), subtitle].filter(Boolean).join(', ')}
        disabled={offline}
        onPress={() => router.push('/zgloszenia')}
        style={({ pressed }) => [styles.row, { minHeight: 64, opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={styles.rowIcon}>
          <Icon name="wrench" color={offline ? disabled : theme.ink} />
        </View>
        <View style={{ flex: 1, gap: 2, paddingVertical: 12 }}>
          <Text style={{ fontSize: 16, color: offline ? disabled : theme.ink }}>{t('help.tickets.title')}</Text>
          {subtitle ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {!offline && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accentMap }} />}
              <Text style={{ fontSize: 13, color: theme.muted }}>{subtitle}</Text>
            </View>
          ) : null}
        </View>
        {!offline && <Icon name="chevron" color={theme.checkbox} size={18} />}
      </Pressable>
    </ListGroup>
  );
}

function FaqCategory({
  category,
  open,
  onToggle,
}: {
  category: PublicFaqCategory;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const theme = useTheme();
  return (
    <>
      <SectionLabel>{category.name}</SectionLabel>
      <ListGroup>
        {category.items.map((item, i) => {
          const expanded = open.has(item.id);
          return (
            <View key={item.id} style={i ? { borderTopWidth: 1, borderColor: theme.line } : null}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => onToggle(item.id)}
                style={({ pressed }) => [styles.question, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 16,
                    lineHeight: 22,
                    fontWeight: expanded ? '600' : '400',
                    color: theme.ink,
                  }}
                >
                  {item.question}
                </Text>
                <View style={{ transform: [{ rotate: expanded ? '-90deg' : '90deg' }] }}>
                  <Icon name="chevron" color={expanded ? theme.ink : theme.muted} size={18} />
                </View>
              </Pressable>
              {expanded && (
                <View style={styles.answer}>
                  <MarkdownView
                    source={item.answerMd}
                    profile="faq"
                    style={{ fontSize: 15, lineHeight: 22, color: theme.ink }}
                  />
                </View>
              )}
            </View>
          );
        })}
      </ListGroup>
    </>
  );
}

/** Wiersz kontaktu: „Zadzwoń” otwiera `tel:`, „Napisz” `mailto:`; działa także bez sieci. */
function ContactRow({
  icon,
  label,
  value,
  href,
  first,
}: {
  icon: IconName;
  label: string;
  value: string;
  href: string;
  first?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label}: ${value}`}
      onPress={() => void Linking.openURL(href).catch(() => undefined)}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: 1, borderColor: theme.line },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} color={theme.ink} />
      </View>
      <Text style={{ flex: 1, fontSize: 16, color: theme.ink }}>{label}</Text>
      <Text
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 15, fontWeight: icon === 'call' ? '500' : '400', color: theme.muted }}
      >
        {value}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  offline: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 54, paddingHorizontal: 16 },
  rowIcon: { width: 24, alignItems: 'center' },
  question: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  answer: { paddingHorizontal: 16, paddingBottom: 16 },
  note: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: -12, marginHorizontal: 4 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
