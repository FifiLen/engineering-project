import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { LegalDocument } from '../../../../../components/site/legal-document';
import { t } from '../../../../../lib/i18n';
import { getLegalVersion, getLegalVersions } from '../../../../../lib/site/api';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slug: string, n: string) {
  if (!SLUG.test(slug) || slug.length > 100 || !/^\d{1,5}$/.test(n)) return null;
  const versions = await getLegalVersions(slug);
  const version = versions ? await getLegalVersion(slug, Number(n)) : null;
  return versions && version ? { versions, version } : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; n: string }>;
}): Promise<Metadata> {
  const { slug, n } = await params;
  const data = await load(slug, n).catch(() => null);
  if (!data) return {};
  // Wersja archiwalna nie trafia do wyszukiwarek ani do mapy strony (ADR 0065).
  return {
    title: t('site.document.archivedTitle', { title: data.version.title, no: data.version.versionNo }),
    robots: { index: false },
    alternates: { canonical: `/${slug}` },
  };
}

/** Wersja archiwalna dokumentu (`/regulamin/wersja/3`) z banerem „obowiązywała od … do …”. */
export default async function LegalVersionPage({ params }: { params: Promise<{ slug: string; n: string }> }) {
  const { slug, n } = await params;
  const data = await load(slug, n);
  if (!data) notFound();
  if (data.version.current) redirect(`/${slug}`);
  return <LegalDocument slug={slug} versions={data.versions} version={data.version} />;
}
