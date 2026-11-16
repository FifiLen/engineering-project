'use client';

/** Dokumenty prawne z wersjami (makiety dostep-dokumenty, dostep-dokument-wersja; ADR 0027). */
import type {
  DocumentVersionDetails,
  DocumentVersionSummary,
  LegalDocumentDetails,
  LegalDocumentSummary,
} from '@hulajnogi/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { ConfirmDialog } from '../confirm-dialog';
import { CheckIcon, PlusIcon } from '../icons';
import { Banner } from './common';

const BASE = '/admin/tresci';
const STATUS_PILL = { DRAFT: 'pill warn', PUBLISHED: 'pill accent', ARCHIVED: 'pill muted' } as const;

function documentMeta(d: LegalDocumentSummary): string {
  if (d.publishedVersionNo === null) return t('access.documents.noPublished');
  return d.consentType
    ? t('access.documents.consentDoc', { version: d.publishedVersionNo })
    : t('access.documents.noConsentDoc', { version: d.publishedVersionNo });
}

function publication(v: DocumentVersionSummary): string {
  if (!v.publishedAt) return t('access.documents.unpublished');
  if (!v.supersededAt) return t('access.documents.publishedFrom', { date: formatDate(v.publishedAt) });
  return t('access.documents.publishedRange', { from: formatDate(v.publishedAt), to: formatDate(v.supersededAt) });
}

/** Zakładka „Dokumenty prawne” w Treściach: lista dokumentów i wersje wybranego. */
export function DocumentsPage({ selectedId }: { selectedId?: string }) {
  const router = useRouter();
  const { can } = useSession();
  const [docs, setDocs] = useState<LegalDocumentSummary[] | null>(null);
  const [doc, setDoc] = useState<LegalDocumentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentId = selectedId ?? docs?.[0]?.id;

  useEffect(() => {
    api<LegalDocumentSummary[]>('/admin/legal-documents')
      .then(setDocs)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    if (currentId)
      api<LegalDocumentDetails>(`/admin/legal-documents/${currentId}`)
        .then(setDoc)
        .catch((e: unknown) => setError(errorMessage(e)));
  }, [currentId]);

  const startDraft = async () => {
    if (!doc) return;
    try {
      const draft = await api<DocumentVersionDetails>(`/admin/legal-documents/${doc.id}/drafts`, { method: 'POST' });
      router.push(`${BASE}/wersje/${draft.id}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const draft = doc?.versions.find((v) => v.status === 'DRAFT');
  const current = doc?.versions.find((v) => v.status === 'PUBLISHED');
  const grid = '100px minmax(0,2fr) 140px minmax(0,1.3fr) 110px';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{t('access.documents.title')}</h1>
          <div className="sub">{t('access.documents.lead')}</div>
        </div>
      </div>
      <nav className="tabs" aria-label={t('access.documents.title')}>
        <span className="tab" aria-current="page">
          {t('access.documents.tab')}
        </span>
      </nav>
      {error && <Banner kind="danger">{error}</Banner>}
      <div className="doc-layout">
        <div className="card doc-list">
          {docs?.map((d) => (
            <Link key={d.id} href={`${BASE}?dokument=${d.id}`} className="doc-item" aria-current={d.id === currentId ? 'page' : undefined}>
              {d.name}
              <small>{documentMeta(d)}</small>
            </Link>
          ))}
        </div>
        {doc && (
          <div className="col">
            <div className="section-head" style={{ alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>{doc.name}</h2>
                <span className="hint">{t('access.documents.address', { slug: doc.slug })}</span>
              </div>
              {can('content.write') &&
                (draft ? (
                  <Link className="btn primary" href={`${BASE}/wersje/${draft.id}`}>
                    {t('access.documents.editDraft')}
                  </Link>
                ) : (
                  <button type="button" className="btn primary" onClick={() => void startDraft()}>
                    <PlusIcon />
                    {t('access.documents.newVersion')}
                  </button>
                ))}
            </div>
            <div className="card" style={{ padding: '14px 0 6px' }}>
              <div className="table" role="table">
                <div className="row head" role="row" style={{ gridTemplateColumns: grid }}>
                  {(['version', 'title', 'status', 'published', 'acceptances'] as const).map((c) => (
                    <span key={c} role="columnheader">
                      {t.dynamic(`access.documents.columns.${c}`)}
                    </span>
                  ))}
                </div>
                {doc.versions.map((v) => (
                  <Link
                    key={v.id}
                    href={`${BASE}/wersje/${v.id}`}
                    className="row link-row"
                    role="row"
                    style={{ gridTemplateColumns: grid, color: 'inherit', textDecoration: 'none' }}
                  >
                    <span role="cell" className="num">
                      {t('access.documents.versionNo', { no: v.versionNo })}
                    </span>
                    <span role="cell">{v.title}</span>
                    <span role="cell">
                      <span className={STATUS_PILL[v.status]}>{t.dynamic(`documentStatus.${v.status}`)}</span>
                    </span>
                    <span role="cell" className="muted">
                      {publication(v)}
                    </span>
                    <span role="cell" className="num">
                      {v.publishedAt ? v.acceptances : t('common.none')}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            {current && doc.consentType && (
              <div className="card client-stats">
                <div>
                  <b>{current.acceptances}</b>
                  <span>{t('access.documents.acceptedCurrent', { version: current.versionNo })}</span>
                </div>
              </div>
            )}
            <div className="banner">
              <div>
                <b>{t('access.documents.immutable')}</b>
                {t('access.documents.immutableBody')}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Podgląd Markdown dokumentu: nagłówki, listy numerowane i punktowane, akapity i pogrubienie. Dokumenty
 * prawne nie potrzebują więcej; pełny edytor treści w iteracji 7.
 */
function MarkdownPreview({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const inline = (text: string) =>
    text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>,
    );
  const lines = source.replace(/<!--[\s\S]*?-->/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      blocks.push(<h3 key={i}>{inline(line.replace(/^#+\s*/, ''))}</h3>);
      continue;
    }
    const ordered = /^\d+\.\s/.test(line);
    if (ordered || line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s/ : /^-\s/).test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^(\d+\.|-)\s+/, ''));
        i++;
      }
      i--;
      const list = items.map((item, k) => <li key={k}>{inline(item)}</li>);
      blocks.push(ordered ? <ol key={i}>{list}</ol> : <ul key={i}>{list}</ul>);
      continue;
    }
    blocks.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="md-preview">{blocks}</div>;
}

/** Wersja dokumentu: edycja wersji roboczej z podglądem, publikacja i usunięcie; inne wersje do odczytu. */
export function VersionEditor({ versionId }: { versionId: string }) {
  const router = useRouter();
  const { can } = useSession();
  const [version, setVersion] = useState<DocumentVersionDetails | null>(null);
  const [doc, setDoc] = useState<LegalDocumentSummary | null>(null);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'delete' | null>(null);

  const apply = (v: DocumentVersionDetails) => {
    setVersion(v);
    setTitle(v.title);
    setSummary(v.changeSummary ?? '');
    setBody(v.bodyMd);
  };
  useEffect(() => {
    api<DocumentVersionDetails>(`/admin/legal-documents/versions/${versionId}`)
      .then((v) => {
        apply(v);
        return api<LegalDocumentSummary[]>('/admin/legal-documents').then((docs) => setDoc(docs.find((d) => d.id === v.documentId) ?? null));
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [versionId]);

  if (!version) return error ? <Banner kind="danger">{error}</Banner> : <div className="card" aria-busy="true" />;
  const editable = version.status === 'DRAFT' && can('content.write');
  const dirty = title !== version.title || summary !== (version.changeSummary ?? '') || body !== version.bodyMd;
  const back = `${BASE}?dokument=${version.documentId}`;

  async function save(): Promise<boolean> {
    setError(null);
    setNotice(null);
    try {
      apply(
        await api<DocumentVersionDetails>(`/admin/legal-documents/versions/${versionId}`, {
          method: 'PATCH',
          json: { title, bodyMd: body, changeSummary: summary.trim() || null },
        }),
      );
      setNotice(t('access.documents.saved'));
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  async function publish() {
    setConfirm(null);
    if (dirty && !(await save())) return;
    try {
      await api(`/admin/legal-documents/versions/${versionId}/publish`, { method: 'POST' });
      router.push(back);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function remove() {
    setConfirm(null);
    try {
      await api(`/admin/legal-documents/versions/${versionId}`, { method: 'DELETE' });
      router.push(back);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <nav className="crumbs" aria-label={t('form.backToList')}>
            <Link href={back}>{t('access.documents.tab')}</Link>
            <span aria-hidden="true">/</span>
            <span>{doc?.name}</span>
            <span aria-hidden="true">/</span>
            <span>{t('access.documents.versionNo', { no: version.versionNo })}</span>
          </nav>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {t('access.documents.versionTitle', { name: doc?.name ?? '', no: version.versionNo })}
            <span className={STATUS_PILL[version.status]}>{t.dynamic(`documentStatus.${version.status}`)}</span>
          </h1>
          <div className="sub">
            {editable
              ? t('access.documents.draftSub', { chars: body.length })
              : t('access.documents.readOnlyVersion', { status: t.dynamic(`documentStatus.${version.status}`).toLowerCase() })}
          </div>
        </div>
        {editable && (
          <div className="actions">
            <button type="button" className="btn danger" onClick={() => setConfirm('delete')}>
              {t('access.documents.deleteDraft')}
            </button>
            <button type="button" className="btn" disabled={!dirty} onClick={() => void save()}>
              {t('access.documents.save')}
            </button>
            <button type="button" className="btn primary" onClick={() => setConfirm('publish')}>
              {t('access.documents.publish')}
            </button>
          </div>
        )}
      </div>
      {error && <Banner kind="danger">{error}</Banner>}
      {notice && <Banner kind="ok">{notice}</Banner>}

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1fr) 330px' }}>
        <div className="col">
          <section className="card section-card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <label className="field">
              <span className="label">{t('access.documents.fieldTitle')}</span>
              <input className="input" value={title} disabled={!editable} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">
                {t('access.documents.fieldSummary')} <span className="opt">{t('access.documents.fieldSummaryHint')}</span>
              </span>
              <input className="input" value={summary} disabled={!editable} onChange={(e) => setSummary(e.target.value)} />
            </label>
          </section>
          <section className="card editor">
            <div>
              <div className="section-head" style={{ marginBottom: 10 }}>
                <span className="label">{t('access.documents.fieldBody')}</span>
              </div>
              <textarea
                value={body}
                readOnly={!editable}
                aria-label={t('access.documents.fieldBody')}
                onChange={(e) => setBody(e.target.value)}
              />
            </div>
            <div>
              <div className="section-head" style={{ marginBottom: 10 }}>
                <span className="label">{t('access.documents.preview')}</span>
                <span className="hint">{t('access.documents.previewHint')}</span>
              </div>
              <MarkdownPreview source={body} />
            </div>
          </section>
        </div>
        {editable && (
          <section className="card side-card">
            <h2>{t('access.documents.afterPublish')}</h2>
            <ul className="check-list">
              {(['afterPublish1', 'afterPublish2', 'afterPublish3'] as const).map((k) => (
                <li key={k}>
                  <CheckIcon size={16} />
                  <span>{t.dynamic(`access.documents.${k}`)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm === 'delete'}
        title={confirm === 'publish' ? t('access.documents.publishTitle', { no: version.versionNo }) : t('access.documents.deleteTitle')}
        body={confirm === 'publish' ? t('access.documents.publishBody') : t('access.documents.deleteBody')}
        action={confirm === 'publish' ? t('access.documents.publish') : t('access.documents.deleteDraft')}
        onConfirm={() => void (confirm === 'publish' ? publish() : remove())}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
