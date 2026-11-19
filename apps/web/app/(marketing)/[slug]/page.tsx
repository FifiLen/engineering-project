import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalDocument } from '../../../components/site/legal-document';
import { getLegalVersion, getLegalVersions } from '../../../lib/site/api';

/** Slug dokumentu jak w API (`content_pages.slug`); inny adres od razu daje 404 bez pytania API. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function load(slug: string) {
  if (!SLUG.test(slug) || slug.length > 100) return null;
  const versions = await getLegalVersions(slug);
  const current = versions?.find((v) => v.current);
  if (!versions || !current) return null;
  const version = await getLegalVersion(slug, current.versionNo);
  return version ? { versions, version } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug).catch(() => null);
  return data ? { title: data.version.title, alternates: { canonical: `/${slug}` } } : {};
}

/** Dokument prawny w obowiązującej wersji: `/regulamin`, `/polityka-prywatnosci`, `/zasady-jazdy`, `/polityka-cookies`. */
export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  return <LegalDocument slug={slug} versions={data.versions} version={data.version} />;
}
