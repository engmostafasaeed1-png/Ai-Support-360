import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { useSlaEnabled, useSlaSettings } from '@/hooks/useSla';
import { severityFor } from '@/lib/sla/policy';
import { langOf } from './slaUi';

/** Shown under the urgency choice when SLA policies are on: the severity it maps to, its definition and examples. */
export default function SeverityGuide({ urgency }: { urgency: string }) {
  const { t, i18n } = useTranslation();
  const lang = langOf(i18n.language);
  const on = useSlaEnabled();
  const s = useSlaSettings().data;
  if (!on || !s) return null;
  const key = severityFor(urgency, s.urgency_map);
  const def = s.severities.find((x) => x.key === key);
  if (!def) return null;
  const examples = lang === 'ar' ? def.examples_ar : def.examples_en;
  return (
    <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-xs" aria-live="polite" data-testid="severity-guide">
      <p className="flex items-center gap-1.5 font-semibold text-foreground"><Info className="h-3.5 w-3.5 text-primary" aria-hidden />
        {t('sla.guide.title', { key, label: lang === 'ar' ? def.label_ar : def.label_en })}</p>
      <p className="mt-1 text-muted-foreground">{lang === 'ar' ? def.definition_ar : def.definition_en}</p>
      {examples.length > 0 && <ul className="mt-1 list-disc ps-5 text-muted-foreground">{examples.map((e) => <li key={e}>{e}</li>)}</ul>}
      <p className="mt-1 text-[11px] text-muted-foreground">{t('sla.guide.note')}</p>
    </div>
  );
}
