import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';
import { t } from '../lib/i18n';
import { siteUrl } from '../lib/site/url';
import './globals.css';

const inter = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-inter' });

/**
 * Domyślne metadane; strona główna bierze tytuł i opis z sekcji `web.meta` (ADR 0065), a podstrony dokładają swój
 * tytuł do wzorca z marką.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: t('meta.title'), template: t('meta.titleTemplate') },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
