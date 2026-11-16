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
  env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001' },
};

export default config;
