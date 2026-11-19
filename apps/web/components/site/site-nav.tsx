'use client';

/** Nawigacja strony z wyróżnieniem bieżącej pozycji (makiety 30-strona-tresci: „Aktualności” podkreślone). */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { t } from '../../lib/i18n';

export const SITE_NAV = [
  { href: '/#jak-to-dziala', label: () => t('site.nav.how') },
  { href: '/#cennik', label: () => t('site.nav.pricing') },
  { href: '/#strefy', label: () => t('site.nav.safety') },
  { href: '/#pytania', label: () => t('site.nav.faq') },
  { href: '/aktualnosci', label: () => t('site.nav.news') },
] as const;

export function SiteNav({ className }: { className: string }) {
  const pathname = usePathname();
  return (
    <nav className={className} aria-label={t('site.nav.label')}>
      {SITE_NAV.map((item) => {
        const current = !item.href.startsWith('/#') && pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={current ? 'page' : undefined}>
            {item.label()}
          </Link>
        );
      })}
    </nav>
  );
}
