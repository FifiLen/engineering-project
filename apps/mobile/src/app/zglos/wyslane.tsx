import { CUSTOMER_TICKET_CATEGORIES, ticketLabel, type CustomerTicketCategory } from '@hulajnogi/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { Group, StatusScreen } from '../../components/payment';
import { IconBadge, Steps } from '../../components/sheet';
import { Button, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { scooterNo } from '../../lib/format';
import { categoryName } from '../../lib/tickets';

const isCategory = (v: string | undefined): v is CustomerTicketCategory =>
  !!v && (CUSTOMER_TICKET_CATEGORIES as readonly string[]).includes(v);

/**
 * Potwierdzenie zgłoszenia (makieta zgloszenie-wyslane; ADR 0055): numer Z-…, stałe kroki „Co dalej”
 * (dla reklamacji opłaty: sprawdzamy opłatę, odpowiedź i ewentualny zwrot) i karta „wyłączona z ruchu”
 * przy kategorii pilnej. „Gotowe” wraca tam, skąd otwarto formularz.
 */
export default function ReportSentScreen() {
  const theme = useTheme();
  const { number, scooter, urgent, billing } = useLocalSearchParams<{
    number: string;
    scooter: string;
    urgent?: string;
    billing?: string;
  }>();
  const claim = billing === '1';
  const scooterNumber = scooterNo(Number(scooter));
  const done = () => (router.canGoBack() ? router.back() : router.replace('/mapa'));

  return (
    <StatusScreen
      icon="check"
      tone="solid"
      title={t('tickets.sent.title')}
      lead={t('tickets.sent.lead')}
      footer={
        <>
          <Button label={t('tickets.sent.done')} onPress={done} />
          <Button label={t('tickets.sent.mine')} kind="secondary" onPress={() => router.replace('/zgloszenia')} />
        </>
      }
    >
      <Text style={{ marginTop: 22, fontSize: 13, color: theme.muted }}>{t('tickets.sent.number')}</Text>
      <Text
        style={{ marginTop: 2, fontSize: 34, fontWeight: '500', letterSpacing: -1, lineHeight: 38, color: theme.ink }}
      >
        {ticketLabel(Number(number))}
      </Text>
      <Steps
        style={{ marginTop: 24, gap: 16 }}
        steps={[
          { label: t('tickets.sent.received'), state: 'done' },
          { label: claim ? t('tickets.sent.checkBilling') : t('tickets.sent.check'), state: 'todo' },
          { label: claim ? t('tickets.sent.replyBilling') : t('tickets.sent.reply'), state: 'todo' },
        ]}
      />
      {isCategory(urgent) && (
        <Group style={{ marginTop: 24, padding: 16, flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
          <IconBadge icon="wrench" tone="neutral" size={40} iconSize={19} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.ink }}>
              {t('tickets.sent.outOfService', { number: scooterNumber })}
            </Text>
            <Text style={{ fontSize: 14, lineHeight: 20, color: theme.muted }}>
              {t('tickets.sent.outOfServiceLead', { category: categoryName(urgent) })}
            </Text>
          </View>
        </Group>
      )}
    </StatusScreen>
  );
}
