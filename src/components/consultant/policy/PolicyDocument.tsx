import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { parsePolicyBody, type PolicyVersion } from '@/lib/consultantPolicy';

interface Props {
  policy: PolicyVersion;
  lang: 'en' | 'ar';
  /** Show the title line (the page and the inline step do; the dialog has its own title). */
  showTitle?: boolean;
  showSummary?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}

const LABELS = {
  en: { version: 'Version', effective: 'effective', summary: 'Summary' },
  ar: { version: 'الإصدار', effective: 'سارٍ من', summary: 'الملخص' },
};

/** The policy text: summary on top, short sections below. Plain text only (no HTML from the database). */
export default function PolicyDocument({ policy, lang, showTitle = true, showSummary = true, headingLevel = 2, className }: Props) {
  const text = lang === 'ar' ? policy.ar : policy.en;
  const l = LABELS[lang];
  const sections = parsePolicyBody(text.body);
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} className={cn('space-y-5 text-start', className)}>
      {showTitle && (
        <header className="space-y-1">
          <p className="text-2xl font-bold text-foreground">{text.title}</p>
          <p className="text-sm text-muted-foreground">
            {l.version} {policy.version}
            {policy.effectiveAt ? ` · ${l.effective} ${format(new Date(policy.effectiveAt), 'd MMM yyyy')}` : ''}
          </p>
        </header>
      )}
      {sections.filter(s => s.heading === null).flatMap(s => s.blocks).filter(b => b.kind === 'note').map((b, i) => (
        <p key={`note-${i}`} className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium text-foreground">{b.text}</p>
      ))}
      {showSummary && (
        <section aria-label={l.summary} className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
          <H className="mb-1 text-base font-semibold text-foreground">{l.summary}</H>
          <p className="text-sm leading-7 text-foreground">{text.summary}</p>
        </section>
      )}
      {sections.map((s, i) => {
        const blocks = s.blocks.filter(b => b.kind !== 'note');
        if (!s.heading && !blocks.length) return null;
        const items = blocks.filter(b => b.kind === 'li');
        return (
          <section key={i} className="space-y-2">
            {s.heading && <H className="text-base font-semibold text-foreground">{s.heading}</H>}
            {blocks.filter(b => b.kind === 'p').map((b, j) => <p key={j} className="text-sm leading-7 text-muted-foreground">{b.text}</p>)}
            {items.length > 0 && (
              <ul className="list-disc space-y-1.5 ps-5 text-sm leading-7 text-muted-foreground">
                {items.map((b, j) => <li key={j}>{b.text}</li>)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
