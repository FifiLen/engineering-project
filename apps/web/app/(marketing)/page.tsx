import { formatPln } from '@hulajnogi/shared';

// Strona promocyjna (szkielet). Projekt: kanwa „Strona promocyjna”, realizacja w iteracji 7.
export default function HomePage() {
  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '96px 24px' }}>
      <h1 style={{ fontSize: 'clamp(48px, 8vw, 96px)', fontWeight: 600, letterSpacing: '-0.045em', lineHeight: 1, margin: 0 }}>
        Hulajnoga zawsze blisko.
      </h1>
      <p style={{ fontSize: 21, color: 'var(--muted)', marginTop: 24 }}>
        Znajdź ją na mapie, zeskanuj kod i ruszaj. Działamy w Rybniku.
      </p>
      <p style={{ fontSize: 14, color: 'var(--muted)' }}>Przykład formatowania kwot z pakietu shared: {formatPln(1250)}</p>
    </main>
  );
}
