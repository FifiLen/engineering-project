import type { NextConfig } from 'next';

// .env z katalogu głównego, jak w API i symulatorze; zmienne z powłoki mają pierwszeństwo.
try {
  process.loadEnvFile('../../.env');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const config: NextConfig = {
  reactStrictMode: true,
  // Adres API widziany z przeglądarki; wpisywany do paczki przy budowaniu.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
    // Adres strony w kodach QR (ADR 0041): podgląd naklejki w panelu pokazuje ten sam adres co PDF z API.
    NEXT_PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL ?? 'http://localhost:3000',
  },
};

export default config;
