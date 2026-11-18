import {
  CUSTOMER_TICKET_CATEGORIES,
  DESCRIPTION_REQUIRED_CATEGORIES,
  TICKET_DESCRIPTION_MAX,
  TICKET_MAX_PHOTOS,
  URGENT_TICKET_CATEGORIES,
  type CustomerScooterView,
  type CustomerTicketCategory,
  type CustomerTicketView,
  type RentalHistoryItem,
  type RentalView,
  type ScooterVariant,
} from '@hulajnogi/shared';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Icon } from '../../components/icons';
import { ListGroup, PageScreen } from '../../components/list';
import { Note } from '../../components/payment';
import { ScooterRender } from '../../components/scooter';
import { BottomSheet } from '../../components/sheet';
import { Button, ErrorBox, Field, useTheme } from '../../components/ui';
import { t } from '../../i18n';
import { api, errorMessage } from '../../lib/api';
import { pickPhoto, uploadPhoto, type LocalPhoto } from '../../lib/files';
import { dayWord, scooterNo, shortDayTime, timeOnly } from '../../lib/format';
import { categoryName } from '../../lib/tickets';

/** Hulajnoga i przejazd zgłoszenia; bez przejazdu nie ma kategorii „Rozliczenie”. */
interface Subject {
  scooter: { id: string; number: number; variant: ScooterVariant };
  rental: { id: string; number: number; startedAt: string | null; endedAt: string | null } | null;
  /** Wejście z profilu: ostatni przejazd z „Zmień” (makieta profil-usterka). */
  changeable: boolean;
}

interface Photo {
  key: string;
  local: LocalPhoto;
  fileId: string | null;
}

const FAULTS = CUSTOMER_TICKET_CATEGORIES.filter((c) => c !== 'BILLING');
const isUrgent = (c: CustomerTicketCategory) => (URGENT_TICKET_CATEGORIES as readonly string[]).includes(c);
const needsDescription = (c: CustomerTicketCategory) =>
  (DESCRIPTION_REQUIRED_CATEGORIES as readonly string[]).includes(c);

const subjectFromRental = (v: RentalView, changeable = false): Subject => ({
  scooter: { id: v.scooter.id, number: v.scooter.number, variant: v.scooter.variant },
  rental: { id: v.id, number: v.number, startedAt: v.startedAt, endedAt: v.endedAt },
  changeable,
});

/**
 * „Zgłoś problem” (makiety zgloszenie-z-przejazdu, profil-usterka; ADR 0055, ADR 0057). Z podsumowania
 * (`rental`) i z karty hulajnogi na mapie (`number`) hulajnoga jest podstawiona bez wyboru; z profilu
 * aplikacja podstawia hulajnogę z ostatniego przejazdu z „Zmień”. Kategorie wielokrotnego wyboru bez
 * łączności (zgłoszenia automatyczne), „Rozliczenie” tylko z przejazdem, opis wymagany przy „Rozliczenie”
 * i „Inne”, do 3 zdjęć wysłanych przed zgłoszeniem (`POST /files`, `TICKET_PHOTO`).
 */
export default function ReportScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ rental?: string; number?: string }>();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [history, setHistory] = useState<RentalHistoryItem[] | null>(null);
  const [categories, setCategories] = useState<CustomerTicketCategory[]>([]);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async (): Promise<Subject | null> => {
      if (params.rental) return subjectFromRental(await api<RentalView>(`/rentals/${params.rental}`));
      if (params.number) {
        const s = await api<CustomerScooterView>(`/scooters/by-number/${Number(params.number)}`);
        return { scooter: { id: s.id, number: s.number, variant: s.variant }, rental: null, changeable: false };
      }
      // Z profilu: ostatni przejazd podstawiony, wybór z historii albo numer hulajnogi.
      const items = await api<RentalHistoryItem[]>('/rentals?limit=20');
      setHistory(items);
      return items[0] ? subjectFromRental(await api<RentalView>(`/rentals/${items[0].id}`), true) : null;
    };
    load()
      .then((s) => {
        setSubject(s);
        if (!s) setChangeOpen(true);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [params.rental, params.number]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/mapa'));
  const toggle = (c: CustomerTicketCategory) =>
    setCategories((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));
  const shown = categories.filter((c) => c !== 'BILLING' || subject?.rental);
  const urgent = shown.some(isUrgent);
  const descriptionRequired = shown.some(needsDescription);
  const ready = !!subject && shown.length > 0 && (!descriptionRequired || description.trim().length > 0) && !uploading;

  async function addPhoto(source: 'camera' | 'library') {
    setSourceOpen(false);
    setError(null);
    let result = await pickPhoto(source).catch(() => null);
    // Bez dostępu do aparatu zdjęcie można dodać z galerii (jak przy zdjęciu parkowania).
    if (result?.kind === 'denied') result = await pickPhoto('library').catch(() => null);
    if (!result || result.kind !== 'photo') return;
    const photo: Photo = { key: `${Date.now()}`, local: result.photo, fileId: null };
    setPhotos((list) => [...list, photo]);
    setUploading(true);
    try {
      const file = await uploadPhoto(result.photo, 'TICKET_PHOTO');
      setPhotos((list) => list.map((p) => (p.key === photo.key ? { ...p, fileId: file.id } : p)));
    } catch (e) {
      setPhotos((list) => list.filter((p) => p.key !== photo.key));
      setError(errorMessage(e));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!subject) return;
    setBusy(true);
    setError(null);
    try {
      const ticket = await api<CustomerTicketView>('/tickets', {
        method: 'POST',
        json: {
          scooterId: subject.scooter.id,
          rentalId: subject.rental?.id ?? null,
          categories: shown,
          description: description.trim() || null,
          photoIds: photos.flatMap((p) => (p.fileId ? [p.fileId] : [])),
        },
      });
      const firstUrgent = shown.find(isUrgent);
      router.replace({
        pathname: '/zglos/wyslane',
        params: {
          number: String(ticket.number),
          scooter: String(subject.scooter.number),
          urgent: firstUrgent ?? '',
          billing: shown.every((c) => c === 'BILLING') ? '1' : '',
        },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const rentalLine = subject?.rental
    ? subject.changeable && subject.rental.id === history?.[0]?.id
      ? t('tickets.form.lastRide', {
          when: shortDayTime(subject.rental.endedAt ?? subject.rental.startedAt ?? new Date().toISOString()),
        })
      : subject.rental.startedAt
        ? t('tickets.form.rideLine', {
            number: subject.rental.number,
            day: dayWord(subject.rental.startedAt),
            from: timeOnly(subject.rental.startedAt),
            to: timeOnly(subject.rental.endedAt ?? subject.rental.startedAt),
          })
        : t('tickets.rentalNumber', { number: subject.rental.number })
    : null;

  return (
    <PageScreen
      title={t('tickets.form.title')}
      onBack={back}
      footer={<Button label={t('tickets.form.submit')} busy={busy} disabled={!ready} onPress={() => void submit()} />}
    >
      {subject ? (
        <ListGroup>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, paddingHorizontal: 16 }}
          >
            <ScooterRender
              variant={subject.scooter.variant}
              side
              style={{ width: 56, height: 46 }}
              label={t('variants.render', { variant: t(`variants.${subject.scooter.variant}`) })}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>
                {t('tickets.scooter', { number: scooterNo(subject.scooter.number) })}
              </Text>
              {rentalLine && <Text style={{ fontSize: 14, color: theme.muted }}>{rentalLine}</Text>}
            </View>
            {subject.changeable && (
              <Pressable accessibilityRole="button" onPress={() => setChangeOpen(true)} hitSlop={8}>
                <Text style={{ fontSize: 16, fontWeight: '500', color: theme.accent }}>{t('tickets.form.change')}</Text>
              </Pressable>
            )}
          </View>
        </ListGroup>
      ) : !error && !changeOpen ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.accent} />
      ) : null}

      <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>
          {t('tickets.form.faults')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {FAULTS.map((c) => (
            <CategoryPill key={c} label={categoryName(c)} on={categories.includes(c)} onPress={() => toggle(c)} />
          ))}
        </View>
        {urgent && (
          <Note>
            {subject?.rental && !subject.rental.endedAt ? t('tickets.form.urgentRide') : t('tickets.form.urgent')}
          </Note>
        )}
      </View>

      {subject?.rental && (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '600', color: theme.ink }}>
            {t('tickets.form.billingSection')}
          </Text>
          <View style={{ flexDirection: 'row' }}>
            <CategoryPill
              label={categoryName('BILLING')}
              icon
              on={categories.includes('BILLING')}
              onPress={() => toggle('BILLING')}
            />
          </View>
        </View>
      )}

      <DescriptionField
        label={descriptionRequired ? t('tickets.form.descriptionRequired') : t('tickets.form.description')}
        value={description}
        onChange={setDescription}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: -6 }}>
        {photos.map((p) => (
          <View key={p.key} style={{ width: 72, height: 72 }}>
            <Image
              source={{ uri: p.local.uri }}
              style={{ width: 72, height: 72, borderRadius: 16, backgroundColor: theme.line }}
              contentFit="cover"
              accessibilityLabel={t('tickets.form.photo')}
            />
            {!p.fileId && (
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 16,
                  backgroundColor: 'rgba(22,24,29,0.35)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityIndicator color="#FFFFFF" />
              </View>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('tickets.form.removePhoto')}
              onPress={() => setPhotos((list) => list.filter((x) => x.key !== p.key))}
              hitSlop={6}
              style={{
                position: 'absolute',
                right: -6,
                top: -6,
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: theme.dark,
                borderWidth: 2,
                borderColor: theme.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="close" color={theme.onDark} size={12} strokeWidth={2.6} />
            </Pressable>
          </View>
        ))}
        {photos.length < TICKET_MAX_PHOTOS && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('tickets.form.addPhoto')}
            disabled={uploading}
            onPress={() => (Platform.OS === 'web' ? void addPhoto('library') : setSourceOpen(true))}
            style={({ pressed }) => ({
              width: 72,
              height: 72,
              borderRadius: 16,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: theme.checkbox,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              opacity: pressed || uploading ? 0.6 : 1,
            })}
          >
            <Icon name="camera" color={theme.muted} />
            <Text style={{ fontSize: 12, color: theme.muted }}>{t('tickets.form.photo')}</Text>
          </Pressable>
        )}
        {photos.length > 0 && (
          <Text style={{ fontSize: 13, color: theme.muted, marginLeft: 4 }}>
            {t('tickets.form.photoCount', { count: photos.length, max: TICKET_MAX_PHOTOS })}
          </Text>
        )}
      </View>

      {error && <ErrorBox message={error} />}

      <BottomSheet visible={sourceOpen} onClose={() => setSourceOpen(false)}>
        <View style={{ gap: 10 }}>
          <Button label={t('tickets.form.takePhoto')} onPress={() => void addPhoto('camera')} />
          <Button label={t('tickets.form.choosePhoto')} kind="secondary" onPress={() => void addPhoto('library')} />
        </View>
      </BottomSheet>

      <ScooterChooser
        visible={changeOpen}
        history={history ?? []}
        onClose={() => setChangeOpen(false)}
        onChoose={(next) => {
          setSubject(next);
          setCategories((list) => (next.rental ? list : list.filter((c) => c !== 'BILLING')));
          setChangeOpen(false);
        }}
      />
    </PageScreen>
  );
}

/** Pigułka kategorii 40 px (`.pillsel`): wybrana grafitowa z haczykiem; „Rozliczenie” z ikoną paragonu. */
function CategoryPill({
  label,
  on,
  onPress,
  icon,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  icon?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        height: 40,
        paddingHorizontal: 16,
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: on ? theme.dark : theme.surface,
        borderWidth: on ? 0 : 1,
        borderColor: theme.line,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {on ? (
        <Icon name="check" color={theme.onDark} size={16} strokeWidth={2.5} />
      ) : icon ? (
        <Icon name="receipt" color={theme.ink} size={16} />
      ) : null}
      <Text style={{ fontSize: 15, fontWeight: '500', color: on ? theme.onDark : theme.ink }}>{label}</Text>
    </Pressable>
  );
}

/** Pole opisu (`.field` 96 px): etykieta nad tekstem, kilka wierszy, obramowanie w kolorze akcji przy fokusie. */
function DescriptionField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        minHeight: 96,
        borderRadius: 16,
        borderWidth: focused ? 1.5 : 1,
        borderColor: focused ? theme.accent : theme.line,
        backgroundColor: theme.surface,
        paddingVertical: 14,
        paddingHorizontal: 16,
        gap: 6,
      }}
    >
      <Text style={{ fontSize: 12, color: theme.muted }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        multiline
        maxLength={TICKET_DESCRIPTION_MAX}
        placeholderTextColor={theme.muted}
        style={{
          fontSize: 16,
          lineHeight: 23,
          color: theme.ink,
          padding: 0,
          minHeight: 46,
          textAlignVertical: 'top',
          ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
        }}
      />
    </View>
  );
}

/**
 * „Zmień” przy wejściu z profilu: hulajnogi z ostatnich przejazdów (z przejazdem, więc z „Rozliczenie”)
 * albo numer z kierownicy (bez przejazdu).
 */
function ScooterChooser({
  visible,
  history,
  onClose,
  onChoose,
}: {
  visible: boolean;
  history: RentalHistoryItem[];
  onClose: () => void;
  onChoose: (subject: Subject) => void;
}) {
  const theme = useTheme();
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recent = history
    .filter((h, i) => history.findIndex((x) => x.scooterNumber === h.scooterNumber) === i)
    .slice(0, 4);

  async function choose(key: string, load: () => Promise<Subject>) {
    setBusy(key);
    setError(null);
    try {
      onChoose(await load());
      setNumber('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ gap: 16 }}>
        <Text
          accessibilityRole="header"
          style={{ fontSize: 22, fontWeight: '600', letterSpacing: -0.4, color: theme.ink }}
        >
          {t('tickets.chooser.title')}
        </Text>
        {recent.length > 0 && (
          <ListGroup>
            {recent.map((h, i) => (
              <Pressable
                key={h.id}
                accessibilityRole="button"
                disabled={!!busy}
                onPress={() =>
                  void choose(h.id, async () => subjectFromRental(await api<RentalView>(`/rentals/${h.id}`), true))
                }
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 14,
                  minHeight: 60,
                  paddingHorizontal: 16,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: theme.line,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ flex: 1, gap: 2, paddingVertical: 10 }}>
                  <Text style={{ fontSize: 16, fontWeight: '500', color: theme.ink }}>
                    {t('tickets.scooter', { number: scooterNo(h.scooterNumber) })}
                  </Text>
                  <Text style={{ fontSize: 13, color: theme.muted }}>
                    {t('tickets.chooser.ride', {
                      number: h.number,
                      when: shortDayTime(h.endedAt ?? h.startedAt ?? new Date().toISOString()),
                    })}
                  </Text>
                </View>
                {busy === h.id ? (
                  <ActivityIndicator color={theme.accent} />
                ) : (
                  <Icon name="chevron" color={theme.checkbox} size={18} />
                )}
              </Pressable>
            ))}
          </ListGroup>
        )}
        <Field
          label={t('tickets.chooser.number')}
          value={number}
          onChangeText={(v) => setNumber(v.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          maxLength={4}
        />
        {error && <Text style={{ fontSize: 14, color: theme.danger }}>{error}</Text>}
        <Button
          label={t('tickets.chooser.confirm')}
          busy={busy === 'number'}
          disabled={!number || !!busy}
          onPress={() =>
            void choose('number', async () => {
              const s = await api<CustomerScooterView>(`/scooters/by-number/${Number(number)}`);
              return { scooter: { id: s.id, number: s.number, variant: s.variant }, rental: null, changeable: true };
            })
          }
        />
      </View>
    </BottomSheet>
  );
}
