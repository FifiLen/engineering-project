import { formatPln, ticketLabel, type CustomerTicketView, type TicketUpdated } from '@hulajnogi/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Icon } from '../../components/icons';
import { ListGroup, PageScreen, SectionLabel } from '../../components/list';
import { AppIcon } from '../../components/notification-banner';
import { Note } from '../../components/payment';
import { StatusChip } from '../../components/ticket';
import { ErrorBox, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { fileUrl } from '../../lib/files';
import { scooterNo, shortDayTime } from '../../lib/format';
import { categoryList, statusName, useTicketEvents } from '../../lib/tickets';

/**
 * Zgłoszenie z odpowiedzią (makieta zgloszenie-szczegoly; ADR 0055, D6, D7): status, kategorie i hulajnoga,
 * karta „Odpowiedź” (jedno pole bez czatu), „Twoje zgłoszenie” z przejazdem, opisem i zdjęciami oraz historia
 * zmian statusu bez nazwisk i notatek. Otwarcie oznacza odpowiedź jako przeczytaną (API). Ścieżka zgodna
 * z `notificationPath` (powiadomienia `ticket_received`, `ticket_status_changed`).
 */
export default function TicketScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [ticket, setTicket] = useState<CustomerTicketView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<CustomerTicketView>(`/me/tickets/${id}`)
      .then(setTicket)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [id]);
  useEffect(load, [load]);
  // Zmiana statusu albo nowa odpowiedź na tym zgłoszeniu; po ponownym połączeniu (`null`) też.
  const onEvent = useCallback(
    (event: TicketUpdated | null) => {
      if (!event || (event.id === id && event.hasUnreadReply)) load();
      else if (event.id === id)
        setTicket((tk) => (tk ? { ...tk, status: event.status, updatedAt: event.updatedAt } : tk));
    },
    [id, load],
  );
  useTicketEvents(onEvent);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/zgloszenia'));
  if (!ticket) {
    return (
      <PageScreen title={t('tickets.details.loading')} onBack={back}>
        {error ? <ErrorBox message={error} /> : <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />}
      </PageScreen>
    );
  }

  const history = [...ticket.history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const rental = ticket.rental;
  const photos = ticket.photos.filter((p) => p.url);
  // Zwrot z reklamacji (ADR 0055): kwota na portfel i paragon korygujący (makieta zgloszenie-szczegoly).
  const refund = ticket.refund;

  return (
    <PageScreen title={t('tickets.details.title', { number: ticketLabel(ticket.number) })} onBack={back}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -4, paddingHorizontal: 4 }}>
        <StatusChip status={ticket.status} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, color: theme.muted }}>
          {t('tickets.details.subtitle', {
            categories: categoryList(ticket.categories),
            number: scooterNo(ticket.scooterNumber),
          })}
        </Text>
      </View>

      {ticket.reply ? (
        <ListGroup>
          <View style={{ paddingTop: 16, paddingHorizontal: 16, paddingBottom: 14, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <AppIcon size={28} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: theme.ink }}>
                {t('tickets.details.reply')}
              </Text>
              <Text style={{ fontSize: 13, color: theme.muted }}>{shortDayTime(ticket.reply.at)}</Text>
            </View>
            <Text style={{ fontSize: 15, lineHeight: 22, color: theme.ink }}>{ticket.reply.text}</Text>
          </View>
          {refund && (
            <View style={[refundRow, { borderColor: theme.line }]}>
              <Text style={{ flex: 1, fontSize: 15, color: theme.muted }}>{t('tickets.details.refund')}</Text>
              <Text style={{ fontSize: 15, fontWeight: '500', color: theme.accent }}>
                {t('tickets.details.refundValue', { amount: formatPln(refund.amount) })}
              </Text>
            </View>
          )}
          {refund?.receiptId && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/paragon/[id]', params: { id: refund.receiptId! } })}
              style={({ pressed }) => [refundRow, { borderColor: theme.line, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ flex: 1, fontSize: 15, color: theme.ink }}>{t('tickets.details.correction')}</Text>
              <Icon name="chevron" color={theme.checkbox} size={18} />
            </Pressable>
          )}
        </ListGroup>
      ) : null}

      <SectionLabel>{t('tickets.details.yours')}</SectionLabel>
      <ListGroup>
        {rental && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/podsumowanie/[id]', params: { id: rental.id, from: 'historia' } })}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              minHeight: 54,
              paddingHorizontal: 16,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ flex: 1, fontSize: 15, color: theme.muted }}>{t('tickets.details.ride')}</Text>
            <Text style={{ fontSize: 15, color: theme.ink }}>
              {rental.endedAt
                ? t('tickets.details.rideValue', { number: rental.number, when: shortDayTime(rental.endedAt) })
                : t('tickets.rentalNumber', { number: rental.number })}
            </Text>
            <Icon name="chevron" color={theme.checkbox} size={18} />
          </Pressable>
        )}
        <Text
          style={{
            paddingTop: 12,
            paddingBottom: 14,
            paddingHorizontal: 16,
            borderTopWidth: rental ? 1 : 0,
            borderColor: theme.line,
            fontSize: 15,
            lineHeight: 22,
            color: ticket.description ? theme.ink : theme.muted,
          }}
        >
          {ticket.description ?? t('tickets.details.noDescription')}
        </Text>
        {photos.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingBottom: 16 }}>
            {photos.map((p) => (
              <Image
                key={p.id}
                source={{ uri: fileUrl(p.url!) }}
                style={{ width: 72, height: 72, borderRadius: 16, backgroundColor: theme.line }}
                contentFit="cover"
                accessibilityLabel={t('tickets.form.photo')}
              />
            ))}
          </View>
        )}
      </ListGroup>

      {!ticket.reply && ticket.status !== 'RESOLVED' && (
        <Note style={{ paddingHorizontal: 4 }}>{t('tickets.details.noReply')}</Note>
      )}

      <SectionLabel>{t('tickets.details.history')}</SectionLabel>
      <View style={{ paddingHorizontal: 4, marginTop: 2 }}>
        {history.map((h, i) => {
          const last = i === history.length - 1;
          return (
            <View key={`${h.status}:${h.at}`} style={{ flexDirection: 'row', gap: 14 }} accessible>
              <View style={{ alignItems: 'center' }}>
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    marginTop: 4,
                    backgroundColor: i === 0 ? theme.ink : theme.checkbox,
                  }}
                />
                {!last && <View style={{ width: 1.5, flex: 1, backgroundColor: theme.line }} />}
              </View>
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingBottom: last ? 0 : 16,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: i === 0 ? '500' : '400', color: theme.ink }}>
                  {statusName(h.status)}
                </Text>
                <Text style={{ fontSize: 15, color: theme.muted }}>{shortDayTime(h.at)}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </PageScreen>
  );
}

const refundRow = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 14,
  minHeight: 54,
  paddingHorizontal: 16,
  borderTopWidth: 1,
} as const;
