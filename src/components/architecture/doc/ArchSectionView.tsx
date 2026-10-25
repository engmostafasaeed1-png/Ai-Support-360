import { useTranslation } from 'react-i18next';
import { sanitizeBrdHtml } from '@/lib/brd/sanitize';
import type { ArchAsset } from '@/lib/architecture/api';
import { SECTION_TITLES, type ArchContent } from '../../../../supabase/functions/_shared/archModel';
import { DiagramView } from './DiagramBlocks';
import TracePicker from './TracePicker';

/** Read-only document body (saved versions for consultants and members, version preview for writers). */
export default function ArchSectionView({ content, assets, renderAfter }: {
  content: ArchContent; assets: ArchAsset[]; renderAfter?: (key: string) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const lang = content.language;
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  let n = 0;
  return (
    <div className="space-y-4" dir={dir} lang={lang}>
      {content.sections.filter((s) => !s.hidden).map((s) => {
        n++;
        return (
          <section key={s.key} id={`sec-${s.key}`} className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby={`h-${s.key}`}>
            <h2 id={`h-${s.key}`} className="text-base font-semibold">{n}. {SECTION_TITLES[s.key][lang]}</h2>
            {s.html ? <div className="brd-prose text-sm" dangerouslySetInnerHTML={{ __html: sanitizeBrdHtml(s.html) }} />
              : !s.diagrams.length && <p className="text-sm text-muted-foreground italic">{t('arch.editor.emptySection')}</p>}
            {s.diagrams.map((d) => <DiagramView key={d.id} d={d} assets={assets} />)}
            {s.trace.length > 0 && <TracePicker value={s.trace} requirements={[]} readOnly />}
            {renderAfter?.(s.key)}
          </section>
        );
      })}
    </div>
  );
}
