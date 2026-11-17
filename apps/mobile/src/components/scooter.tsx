/**
 * Hulajnoga na ekranach: render według wariantu (docs/projekt/rendery), suwak odblokowania (makieta
 * produkt-hulajnoga) i układ ekranu oczekiwania na hulajnogę (odblokowywanie, wznawianie, kończenie).
 */
import type { ScooterVariant } from '@hulajnogi/shared';
import { Image } from 'expo-image';
import { useMemo, useState, type ReactNode } from 'react';
import { Animated, PanResponder, Text, View, type ImageStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from './icons';
import { useTheme } from './ui';

const RENDERS = {
  GRAFIT: require('../../assets/images/rendery/hulajnoga-grafit-trzy.png'),
  BETON: require('../../assets/images/rendery/hulajnoga-beton-trzy.png'),
  KOBALT: require('../../assets/images/rendery/hulajnoga-kobalt-trzy.png'),
  side: require('../../assets/images/rendery/hulajnoga-grafit-bok.png'),
} as const;

/** Widok trzy czwarte według wariantu; widok z boku tylko dla Grafitu (jedyny render z boku). */
export function ScooterRender({
  variant,
  side,
  style,
  dimmed,
  label,
}: {
  variant: ScooterVariant;
  side?: boolean;
  style: ImageStyle;
  dimmed?: boolean;
  label: string;
}) {
  const source = side && variant === 'GRAFIT' ? RENDERS.side : RENDERS[variant];
  return (
    <Image
      source={source}
      style={[style, dimmed ? { opacity: 0.45 } : null]}
      contentFit="contain"
      accessibilityLabel={label}
      accessible
    />
  );
}

const KNOB = 56;

/**
 * Suwak „Przesuń, aby odblokować”: zabezpieczenie przed przypadkowym startem płatnego przejazdu.
 * Czytnik ekranu dostaje zwykły przycisk (akcja `activate`).
 */
export function UnlockSlider({ label, onUnlock, disabled }: { label: string; onUnlock: () => void; disabled?: boolean }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  // Gest powstaje od nowa po zmianie szerokości albo blokady; w trakcie przeciągania ekran się nie zmienia.
  const responder = useMemo(() => {
    const max = Math.max(0, width - KNOB - 8);
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderMove: (_, g) => x.setValue(Math.min(max, Math.max(0, g.dx))),
      onPanResponderRelease: (_, g) => {
        if (g.dx >= max * 0.85) {
          Animated.timing(x, { toValue: max, duration: 120, useNativeDriver: false }).start(() => {
            onUnlock();
            x.setValue(0);
          });
        } else Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      },
    });
  }, [width, disabled, onUnlock, x]);

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => !disabled && onUnlock()}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height: 64, borderRadius: 32, backgroundColor: theme.line, justifyContent: 'center', opacity: disabled ? 0.6 : 1 }}
    >
      <Text style={{ position: 'absolute', left: KNOB + 24, right: 16, fontSize: 16, fontWeight: '500', color: theme.muted }}>
        {label}
      </Text>
      <Animated.View
        {...responder.panHandlers}
        style={{
          position: 'absolute',
          left: 4,
          width: KNOB,
          height: KNOB,
          borderRadius: KNOB / 2,
          backgroundColor: theme.accent,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ translateX: x }],
        }}
      >
        <Icon name="arrow" color="#FFFFFF" size={22} strokeWidth={2.2} />
      </Animated.View>
    </View>
  );
}

/** Ekran oczekiwania: nagłówek, render, tytuł, opis, kroki i przypis albo przyciski na dole. */
export function WaitScreen({
  header,
  variant,
  dimmed,
  title,
  lead,
  children,
  footer,
}: {
  header: ReactNode;
  variant: ScooterVariant;
  dimmed?: boolean;
  title: string;
  lead: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 }}>
        <View style={{ minHeight: 44, justifyContent: 'center' }}>{header}</View>
        <ScooterRender variant={variant} dimmed={dimmed} style={{ height: dimmed ? 260 : 320, width: '100%', marginTop: 8 }} label={title} />
        <Text accessibilityRole="header" style={{ fontSize: 32, fontWeight: '600', letterSpacing: -1, lineHeight: 36, color: theme.ink, marginTop: 16 }}>
          {title}
        </Text>
        <Text style={{ fontSize: 16, lineHeight: 24, color: theme.muted, marginTop: 10 }}>{lead}</Text>
        {children}
        <View style={{ flex: 1 }} />
        {footer}
      </View>
    </SafeAreaView>
  );
}

/** Przypis pod ekranem oczekiwania (np. „Opłata zacznie się naliczać dopiero po odblokowaniu”). */
export function FootNote({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 14, lineHeight: 21, color: theme.muted, textAlign: 'center', paddingHorizontal: 8 }}>{children}</Text>;
}
