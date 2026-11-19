'use client';

/**
 * Dane firmy (makieta tresci-dane-firmy, ADR 0062): sprzedawca na paragonach i wydrukach, kontakt pomocy na stronie,
 * w aplikacji i na wydrukach, dane rejestrowe (opcjonalnie, w stopce strony). Podgląd z `content.read`, zapis tylko
 * z `company.write` (Administrator); zapis częściowy z blokadą wersji i historią z „Przywróć”.
 */
import {
  COMPANY_HOURS_MAX,
  type CompanyProfileView,
  type ContentHistoryEntry,
  type ContentIssueView,
} from '@hulajnogi/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { api, errorMessage } from '../../../lib/api';
import { formatDate, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { Banner } from '../access/common';
import { AlertIcon, DocumentIcon, GlobeIcon, InfoIcon, MailIcon, PhoneIcon, ReceiptIcon } from '../icons';
import { apiIssues, ContentHead, HistoryList, issueMessage, useContentHistory } from './content-common';

const FIELDS = [
  'name',
  'street',
  'postalCode',
  'city',
  'taxId',
  'supportEmail',
  'supportPhone',
  'supportHours',
  'regon',
  'krs',
  'registryCourt',
  'shareCapital',
] as const;
type Field = (typeof FIELDS)[number];
type Form = Record<Field, string>;

const capitalText = (grosze: number | null) => (grosze === null ? '' : String(grosze / 100).replace('.', ','));

function toForm(c: CompanyProfileView): Form {
  return {
    name: c.name,
    street: c.street,
    postalCode: c.postalCode,
    city: c.city,
    taxId: c.taxId,
    supportEmail: c.supportEmail,
    supportPhone: c.supportPhone,
    supportHours: c.supportHours,
    regon: c.regon ?? '',
    krs: c.krs ?? '',
    registryCourt: c.registryCourt ?? '',
    shareCapital: capitalText(c.shareCapitalGrosze),
  };
}

/** Wartość pola w żądaniu `PATCH /admin/company` (puste pola rejestrowe to `null`, NIP bez kresek). */
function payloadValue(field: Field, value: string): unknown {
  const v = value.trim();
  if (field === 'taxId' || field === 'regon' || field === 'krs') return v ? v.replace(/[\s-]/g, '') : null;
  if (field === 'registryCourt') return v || null;
  if (field === 'shareCapital') {
    if (!v) return null;
    const amount = Number(v.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
  }
  return v;
}

const apiField = (field: Field) => (field === 'shareCapital' ? 'shareCapitalGrosze' : field);

export function CompanyPage() {
  const { can } = useSession();
  const canWrite = can('company.write');
  const [company, setCompany] = useState<CompanyProfileView | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [restoredFrom, setRestoredFrom] = useState<number | null>(null);
  const [issues, setIssues] = useState<ContentIssueView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const history = useContentHistory('/admin/company/history', company?.version);

  const apply = (c: CompanyProfileView) => {
    setCompany(c);
    setForm(toForm(c));
    setRestoredFrom(null);
    setIssues([]);
  };
  useEffect(() => {
    api<CompanyProfileView>('/admin/company')
      .then(apply)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const original = company ? toForm(company) : null;
  const changed = form && original ? FIELDS.filter((f) => form[f].trim() !== original[f].trim()) : [];

  async function save() {
    if (!company || !form) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body: Record<string, unknown> = { version: company.version, restoredFrom };
    for (const field of changed) body[apiField(field)] = payloadValue(field, form[field]);
    try {
      apply(await api<CompanyProfileView>('/admin/company', { method: 'PATCH', json: body }));
      setNotice(t('content.company.saved'));
    } catch (e) {
      const found = apiIssues(e);
      setIssues(found);
      setError(found.length ? t('content.editor.fix') : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const restore = (entry: ContentHistoryEntry) => {
    if (!form || !entry.after) return;
    const after = entry.after;
    const next = { ...form };
    for (const field of FIELDS) {
      const value = after[apiField(field)];
      if (field === 'shareCapital') next.shareCapital = typeof value === 'number' ? capitalText(value) : '';
      else if (typeof value === 'string') next[field] = value;
      else if (value === null) next[field] = '';
    }
    setForm(next);
    setRestoredFrom(entry.auditId);
    setShowHistory(false);
  };

  const input = (field: Field, opts: { type?: string; icon?: ReactNode; maxLength?: number; mono?: boolean } = {}) => {
    if (!form || !original) return null;
    const fieldIssues = issues.filter((i) => i.field === apiField(field));
    const changedField = changed.includes(field);
    return (
      <label className="field">
        <span className="label">{t.dynamic(`content.company.fields.${field}`)}</span>
        <span className={opts.icon ? 'ct-input-icon' : undefined}>
          {opts.icon}
          <input
            className={opts.mono ? 'input num' : 'input'}
            type={opts.type ?? 'text'}
            value={form[field]}
            readOnly={!canWrite}
            maxLength={opts.maxLength}
            aria-invalid={fieldIssues.length > 0}
            onChange={(e) => setForm({ ...form, [field]: e.target.value })}
          />
        </span>
        {changedField && original[field] && (
          <span className="hint">{t('content.company.previous', { value: original[field] })}</span>
        )}
        {!changedField && t.has(`content.company.hints.${field}`) && (
          <span className="hint">{t.dynamic(`content.company.hints.${field}`)}</span>
        )}
        {fieldIssues.map((issue, i) => (
          <span key={i} className="err ct-line">
            <AlertIcon size={14} />
            {issueMessage(issue)}
          </span>
        ))}
      </label>
    );
  };

  const uses = [
    { key: 'receipt', icon: <ReceiptIcon size={16} /> },
    { key: 'footer', icon: <GlobeIcon size={16} /> },
    { key: 'app', icon: <PhoneIcon size={16} /> },
    { key: 'documents', icon: <DocumentIcon size={16} /> },
  ];

  return (
    <>
      <ContentHead />
      {error && <Banner kind="danger">{error}</Banner>}
      {notice && <Banner kind="ok">{notice}</Banner>}
      {!canWrite && company && <Banner kind="warn">{t('content.company.readOnly')}</Banner>}
      {form && company && (
        <div className="ct-company">
          <section className="card section-card ct-company-form">
            <div className="section-head">
              <h2>{t('content.company.seller')}</h2>
              <span className="small">{t('content.company.sellerNote')}</span>
            </div>
            {input('name')}
            <div className="ct-grid-addr">
              {input('street')}
              {input('postalCode', { maxLength: 6, mono: true })}
              {input('city')}
            </div>
            <div className="ct-two">{input('taxId', { maxLength: 13, mono: true })}</div>
            <hr />
            <div className="section-head">
              <h2>{t('content.company.support')}</h2>
              <span className="small">{t('content.company.supportNote')}</span>
            </div>
            <div className="ct-two">
              {input('supportEmail', { type: 'email', icon: <MailIcon size={16} /> })}
              {input('supportPhone', { type: 'tel', icon: <PhoneIcon size={16} /> })}
            </div>
            {input('supportHours', { maxLength: COMPANY_HOURS_MAX })}
            <hr />
            <div className="section-head">
              <h2>{t('content.company.registry')}</h2>
              <span className="small">{t('content.company.registryNote')}</span>
            </div>
            <div className="ct-two">
              {input('regon', { maxLength: 14, mono: true })}
              {input('krs', { maxLength: 10, mono: true })}
            </div>
            <div className="ct-two">
              {input('registryCourt')}
              {input('shareCapital', { mono: true })}
            </div>
            {issues
              .filter((i) => !FIELDS.some((f) => apiField(f) === i.field))
              .map((issue, i) => (
                <span key={i} className="err ct-line">
                  <AlertIcon size={14} />
                  {issueMessage(issue)}
                </span>
              ))}
            {showHistory && <HistoryList entries={history} canRestore={canWrite} onRestore={restore} />}
            <div className="ct-foot">
              <span className="small grow">
                {t('content.company.meta', {
                  version: company.version,
                  name: company.updatedByName ?? t('content.history.seed'),
                  date: formatDate(company.updatedAt),
                })}
                {' · '}
                <button type="button" className="link" onClick={() => setShowHistory((v) => !v)}>
                  {t('content.faq.history', { count: history?.length ?? 0 })}
                </button>
                {restoredFrom !== null && ` · ${t('content.history.restoredPending')}`}
              </span>
              {canWrite && (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={!changed.length || busy}
                    onClick={() => apply(company)}
                  >
                    {t('content.editor.discard')}
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!changed.length || busy}
                    onClick={() => void save()}
                  >
                    {t('content.company.save', { count: changed.length })}
                  </button>
                </>
              )}
            </div>
          </section>
          <div className="col">
            <section className="card section-card">
              <h2>{t('content.company.usesTitle')}</h2>
              {uses.map((u) => (
                <div key={u.key} className="ct-where">
                  <span className="wi">{u.icon}</span>
                  <span className="stack">
                    <b>{t.dynamic(`content.company.uses.${u.key}.title`)}</b>
                    <small className="muted">{t.dynamic(`content.company.uses.${u.key}.fields`)}</small>
                    <span>{t.dynamic(`content.company.uses.${u.key}.body`)}</span>
                  </span>
                </div>
              ))}
            </section>
            <div className="banner ok">
              <InfoIcon size={16} />
              <span>{t('content.company.brandNote')}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
