import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { diffStats, type DiffOp, type SectionDiff } from '../../../supabase/functions/_shared/brdDiff';

export function DiffOps({ ops, dir }: { ops: DiffOp[]; dir?: 'ltr' | 'rtl' }) {
  const { t } = useTranslation();
  return (
    <p dir={dir} className="text-sm whitespace-pre-wrap leading-relaxed">
      {ops.map((o, i) => o.type === 'eq' ? <span key={i}>{o.text}</span>
        : o.type === 'add' ? <ins key={i} className="brd-diff-add" aria-label={t('brd.diff.added')}>{o.text}</ins>
        : <del key={i} className="brd-diff-del" aria-label={t('brd.diff.removed')}>{o.text}</del>)}
    </p>
  );
}

/** Per-section comparison (only changed sections are shown, with added / removed word counts). */
export default function BrdDiffView({ diffs, dir }: { diffs: SectionDiff[]; dir: 'ltr' | 'rtl' }) {
  const { t } = useTranslation();
  const changed = diffs.filter((d) => d.changed || d.moved);
  if (changed.length === 0) return <p className="text-sm text-muted-foreground">{t('brd.diff.none')}</p>;
  return (
    <div className="space-y-4">
      {changed.map((d) => {
        const st = diffStats(d.ops);
        return (
          <section key={d.key} className="rounded-xl border border-border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold">{d.title}</h4>
              {st.added > 0 && <Badge variant="secondary" className="text-[10px]">+{st.added}</Badge>}
              {st.removed > 0 && <Badge variant="secondary" className="text-[10px]">−{st.removed}</Badge>}
              {d.visibility && <Badge variant="outline" className="text-[10px]">{d.visibility.after ? t('brd.diff.shown') : t('brd.diff.hidden')}</Badge>}
              {d.moved && <Badge variant="outline" className="text-[10px]">{t('brd.diff.moved')}</Badge>}
            </div>
            <DiffOps ops={d.ops} dir={dir} />
            {d.opsAr && <DiffOps ops={d.opsAr} dir="rtl" />}
          </section>
        );
      })}
    </div>
  );
}
