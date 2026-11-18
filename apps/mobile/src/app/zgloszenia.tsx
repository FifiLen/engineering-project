import { ticketLabel, type CustomerTicketListItem } from '@hulajnogi/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon } from '../components/icons';
import { ListGroup, PageScreen } from '../components/list';
import { Note } from '../components/payment';
import { IconBadge } from '../components/sheet';
import { StatusChip } from '../components/ticket';
import { Button, ErrorBox, useTheme } from '../components/ui';
import { t } from '../i18n';
import { api, errorMessage } from '../lib/api';
import { listDate, scooterNo } from '../lib/format';
import { categoryList, statusName, ticketIcon, useTicketEvents } from '../lib/tickets';

/**
 * Moje zgłoszenia (makieta moje-zgloszenia; ADR 0055): jedna lista od ostatniej zmiany, kobaltowa kropka
 * i pogrubiony tytuł przy nieprzeczytanej odpowiedzi, odświeżanie przez `ticket.updated`. Zgłoszeń
 * automatycznych i założonych przez operatora API klientowi nie podaje.
 */
export default function TicketsScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<CustomerTicketListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<CustomerTicketListItem[]>('/me/tickets')
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useFocusEffect(load);
  useTicketEvents(load);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/profil'));
  const report = <Button label={t('tickets.form.title')} kind="secondary" onPress={() => router.push('/zglos')} />;

  if (items && !items.length) {
    return (
      <PageScreen title={t('tickets.list.title')} onBack={back} footer={report}>
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingBottom: 60 }}
        >
          <IconBadge icon="wrench" tone="neutral" size={72} iconSize={28} />
          <Text
            accessibilityRole="header"
            style={{ marginTop: 20, fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
          >
            {t('tickets.list.empty.title')}
          </Text>
          <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, textAlign: 'center', color: theme.muted }}>
            {t('tickets.list.empty.lead')}
          </Text>
        </View>
      </PageScreen>
    );
  }

  return (
    <PageScreen title={t('tickets.list.title')} onBack={back} footer={report}>
      {error && <ErrorBox message={error} />}
      {!items ? (
        !error && <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />
      ) : (
        <>
          <ListGroup>
            {items.map((item, i) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={[
                  categoryList(item.categories),
                  statusName(item.status),
                  item.hasUnreadReply ? t('tickets.list.unread') : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
                onPress={() => router.push({ pathname: '/zgloszenie/[id]', params: { id: item.id } })}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  minHeight: 76,
                  paddingLeft: 16,
                  paddingRight: 12,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: theme.line,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <IconBadge icon={ticketIcon(item.categories)} tone="neutral" size={40} iconSize={19} />
                <View style={{ flex: 1, gap: 4, paddingVertical: 12, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        fontSize: 16,
                        fontWeight: item.hasUnreadReply ? '600' : '500',
                        color: theme.ink,
                      }}
                    >
                      {categoryList(item.categories)}
                    </Text>
                    {item.hasUnreadReply && (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accentMap }} />
                    )}
                    <StatusChip status={item.status} />
                  </View>
                  <Text style={{ fontSize: 13, color: theme.muted }}>
                    {t('tickets.list.line', {
                      ticket: ticketLabel(item.number),
                      scooter: scooterNo(item.scooterNumber),
                      when: listDate(item.updatedAt),
                    })}
                  </Text>
                </View>
                <Icon name="chevron" color={theme.checkbox} size={18} />
              </Pressable>
            ))}
          </ListGroup>
          <Note style={{ marginTop: -4, paddingHorizontal: 4 }}>{t('tickets.list.note')}</Note>
        </>
      )}
    </PageScreen>
  );
}
