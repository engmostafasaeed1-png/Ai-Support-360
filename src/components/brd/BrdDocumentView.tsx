import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { sanitizeBrdHtml } from '@/lib/brd/sanitize';
import {
  SECTION_TITLES, changeLogRows, countTbc, visibleSections,
  type BrdContent, type SectionKey, type VersionMeta,
} from '../../../supabase/functions/_shared/brdModel';

interface Props {
  content: BrdContent;
  version: number | null;
  versions: VersionMeta[];
  /** Extra content under each section (comment threads in the reader). */
  renderSectionFooter?: (key: SectionKey) => ReactNode;
}

/** Read-only rendering of a BRD (viewer, version preview). Section HTML is re-sanitised before display. */
export default function BrdDocumentView({ content, version, versions, renderSectionFooter }: Props) {
  const { t } = useTranslation();
  const lang = content.language === 'ar' ? 'ar' : 'en';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const tbc = content.sections.reduce((n, s) => n + countTbc(s.html) + countTbc(s.html_ar ?? ''), 0);
  const c = content.control;
  return (
    <article dir={dir} lang={lang} className="space-y-6">
      <header className="rounded-2xl bg-primary text-primary-foreground p-6">
        <p className="text-xs uppercase tracking-wide opacity-80">{t('brd.title')}</p>
        <h2 className="text-xl font-bold mt-1">{c.title}</h2>
        <p className="text-xs opacity-80 mt-1">#{c.ticket_ref} · {version ? `v${version}` : t('brd.status.draft')} · {c.status === 'final' ? t('brd.status.final') : t('brd.status.draft')}</p>
      </header>
      <section aria-labelledby="brd-control" className="rounded-2xl border border-border p-4">
        <h3 id="brd-control" className="font-semibold mb-2">{t('brd.control.heading')}</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {([
            ['title', c.title], ['ticket', `#${c.ticket_ref}`], ['company', c.company], ['requester', c.requester],
            ['date', c.date], ['approvers', c.approvers],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex gap-2"><dt className="text-muted-foreground min-w-28">{t(`brd.control.${k}`)}</dt><dd className="font-medium break-words">{v || '—'}</dd></div>
          ))}
        </dl>
        {tbc > 0 && <p className="mt-3 text-xs rounded-lg bg-warning/15 text-foreground px-2 py-1 inline-block">{t('brd.tbcCount', { count: tbc })}</p>}
      </section>
      {visibleSections(content).map((s) => (
        <section key={s.key} aria-labelledby={`brd-s-${s.key}`} className="space-y-2">
          <h3 id={`brd-s-${s.key}`} className="text-base font-semibold text-foreground border-s-4 border-accent ps-2">
            {s.number}. {SECTION_TITLES[s.key][lang]}
          </h3>
          {s.key === 'change_log' ? (
            <div className="overflow-x-auto">
              <table className="brd-table">
                <thead><tr><th>{t('brd.versions.version')}</th><th>{t('brd.control.date')}</th><th>{t('brd.versions.status')}</th><th>{t('brd.versions.by')}</th><th>{t('brd.versions.note')}</th></tr></thead>
                <tbody>{changeLogRows(versions, lang).map((r) => (
                  <tr key={r.version}><td className="font-semibold">{r.version}</td><td>{r.date}</td><td>{r.status === 'final' ? t('brd.status.final') : t('brd.status.draft')}</td><td>{r.author}</td><td>{r.note}{r.archived ? ` (${t('brd.versions.archived')})` : ''}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : (
            <>
              {s.html ? <div className="brd-prose text-sm" dangerouslySetInnerHTML={{ __html: sanitizeBrdHtml(s.html) }} /> : <p className="text-sm text-muted-foreground italic">{t('brd.emptySection')}</p>}
              {content.language === 'both' && s.html_ar && (
                <div dir="rtl" lang="ar" className="brd-prose text-sm border-t border-dashed border-border pt-2" dangerouslySetInnerHTML={{ __html: sanitizeBrdHtml(s.html_ar) }} />
              )}
              {s.key === 'functional' && content.requirements.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="brd-table">
                    <thead><tr><th>{t('brd.req.id')}</th><th>{t('brd.req.description')}</th><th>{t('brd.req.priority')}</th><th>{t('brd.req.status')}</th><th>{t('brd.req.owner')}</th><th>{t('brd.req.acceptance')}</th></tr></thead>
                    <tbody>{content.requirements.map((r) => (
                      <tr key={r.id}>
                        <td className="font-semibold whitespace-nowrap">{r.id}</td>
                        <td>{r.description}{r.description_ar && <div dir="rtl" className="mt-1">{r.description_ar}</div>}</td>
                        <td><Badge variant="secondary" className="text-[10px]">{t(`brd.req.p_${r.priority}`)}</Badge></td>
                        <td>{t(`brd.req.s_${r.status}`)}</td>
                        <td>{r.owner}</td>
                        <td>{r.acceptance}{r.acceptance_ar && <div dir="rtl" className="mt-1">{r.acceptance_ar}</div>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {renderSectionFooter?.(s.key)}
        </section>
      ))}
      <p className="text-xs text-muted-foreground border-t border-border pt-3">{t('brd.confidential')}</p>
    </article>
  );
}
