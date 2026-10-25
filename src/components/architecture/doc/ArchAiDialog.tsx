import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sanitizeBrdHtml } from '@/lib/brd/sanitize';
import { runArchAi, type ArchAiAction, type ArchAiResult } from '@/lib/architecture/api';
import type { AiReport } from '@/lib/brd/api';
import { SECTION_TITLES, componentTargets, htmlIsEmpty, type ArchContent, type ArchSectionKey } from '../../../../supabase/functions/_shared/archModel';
import type { ArchListRow } from '@/lib/architecture/api';

/** One proposed change: which section, new text, and whether it replaces text the client already wrote. */
export interface AiChange { key: ArchSectionKey; html: string; trace: Array<{ ticket_ref: string; req_id: string }>; replaces: boolean }

/** Turns an AI result into proposed section changes (pure, unit-tested). */
export function proposedChanges(result: ArchAiResult, content: ArchContent): AiChange[] {
  const cur = (k: ArchSectionKey) => content.sections.find((s) => s.key === k);
  if (result.kind === 'draft') {
    return result.sections.flatMap((s) => {
      const c = cur(s.key as ArchSectionKey);
      return c && !htmlIsEmpty(s.html) ? [{ key: c.key, html: s.html, trace: s.trace, replaces: !htmlIsEmpty(c.html) }] : [];
    });
  }
  if (result.kind === 'components') {
    const tg = componentTargets(content.type);
    const out: AiChange[] = [];
    if (tg.components && !htmlIsEmpty(result.components)) out.push({ key: tg.components, html: result.components, trace: [], replaces: !htmlIsEmpty(cur(tg.components)?.html ?? '') });
    if (tg.integrations && !htmlIsEmpty(result.integrations)) out.push({ key: tg.integrations, html: result.integrations, trace: [], replaces: !htmlIsEmpty(cur(tg.integrations)?.html ?? '') });
    return out;
  }
  return [];
}

/**
 * AI assist (only when the owner switched AI on). Never writes on its own: it shows what it would change; sections
 * that already have text are only replaced when the client ticks them.
 */
export default function ArchAiDialog({ open, onOpenChange, docId, content, links, usage, onApply }: {
  open: boolean; onOpenChange: (v: boolean) => void; docId: string; content: ArchContent; links: ArchListRow['links'];
  usage?: { doc_today: number; org_today: number; doc_limit: number; org_limit: number };
  onApply: (changes: AiChange[]) => void;
}) {
  const { t } = useTranslation();
  const lang = content.language;
  const [action, setAction] = useState<ArchAiAction>('arch_draft');
  const [ticket, setTicket] = useState<string>(links[0]?.ticket_id ?? 'none');
  const [step, setStep] = useState<string | null>(null);
  const [result, setResult] = useState<(ArchAiResult & { report: AiReport }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const ac = useRef<AbortController | null>(null);
  const changes = result ? proposedChanges(result, content) : [];

  const run = async () => {
    setResult(null); setError(null); setStep('reading');
    ac.current = new AbortController();
    const r = await runArchAi({ action, docId, ticketId: ticket === 'none' ? null : ticket, content, language: lang }, (s) => setStep(s), ac.current.signal);
    setStep(null);
    if (r.error) { setError(r.error.code === 'doc_limit' || r.error.code === 'org_limit' ? t('arch.ai.limit') : r.error.code === 'ai_off' ? t('arch.ai.off') : r.error.message); return; }
    if (r.result) {
      setResult(r.result);
      setPick(Object.fromEntries(proposedChanges(r.result, content).map((c) => [c.key, !c.replaces])));
    }
  };
  const apply = () => { onApply(changes.filter((c) => pick[c.key])); onOpenChange(false); setResult(null); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) ac.current?.abort(); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />{t('arch.ai.title')}</DialogTitle>
          <DialogDescription>{t('arch.ai.hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ai-action">{t('arch.ai.action')}</Label>
            <Select value={action} onValueChange={(v) => { setAction(v as ArchAiAction); setResult(null); }}>
              <SelectTrigger id="ai-action"><SelectValue /></SelectTrigger>
              <SelectContent>{(['arch_draft', 'arch_components', 'arch_review'] as const).map((a) => <SelectItem key={a} value={a}>{t(`arch.ai.${a}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-ticket">{t('arch.ai.source')}</Label>
            <Select value={ticket} onValueChange={setTicket}>
              <SelectTrigger id="ai-ticket"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('arch.ai.noTicket')}</SelectItem>
                {links.map((l) => <SelectItem key={l.ticket_id} value={l.ticket_id}>{l.ref} · {l.title.slice(0, 40)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {usage && <p className="text-xs text-muted-foreground">{t('arch.ai.usage', { a: usage.doc_today, b: usage.doc_limit, c: usage.org_today, d: usage.org_limit })}</p>}
        <div className="flex gap-2">
          <Button onClick={run} disabled={!!step} className="gap-1"><Sparkles className="h-4 w-4" />{step ? t(`arch.ai.step_${step}`, t('arch.ai.working')) : t('arch.ai.run')}</Button>
          {step && <Button variant="outline" onClick={() => ac.current?.abort()} className="gap-1"><Square className="h-3.5 w-3.5" />{t('arch.ai.stop')}</Button>}
        </div>
        <div aria-live="polite" className="space-y-3">
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {result?.kind === 'review' && (
            result.findings.length === 0 ? <p className="text-sm">{t('arch.ai.noFindings')}</p> : (
              <ul className="space-y-2">
                {result.findings.map((f, i) => (
                  <li key={i} className="rounded-xl border border-border p-3 text-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={f.severity === 'high' ? 'destructive' : 'outline'} className="text-[10px]">{t(`arch.ai.sev_${f.severity}`)}</Badge>
                      <span className="text-xs text-muted-foreground">{f.section === 'general' ? t('arch.ai.general') : SECTION_TITLES[f.section as ArchSectionKey]?.[lang] ?? f.section}</span>
                    </div>
                    <p>{f.finding}</p>
                    {f.suggestion && <p className="text-xs text-muted-foreground">{f.suggestion}</p>}
                  </li>
                ))}
              </ul>
            )
          )}
          {result && result.kind !== 'review' && (
            changes.length === 0 ? <p className="text-sm">{t('arch.ai.nothing')}</p> : (
              <>
                {result.report.secrets + result.report.contacts > 0 && <p className="text-xs text-muted-foreground">{t('arch.ai.cleaned')}</p>}
                <ul className="space-y-2">
                  {changes.map((c) => (
                    <li key={c.key} className="rounded-xl border border-border p-3 space-y-2">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox checked={!!pick[c.key]} onCheckedChange={(v) => setPick({ ...pick, [c.key]: !!v })} />
                        {SECTION_TITLES[c.key][lang]}
                        {c.replaces && <Badge variant="outline" className="text-[10px]">{t('arch.ai.replaces')}</Badge>}
                      </label>
                      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="brd-prose text-sm max-h-40 overflow-y-auto" dangerouslySetInnerHTML={{ __html: sanitizeBrdHtml(c.html) }} />
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setResult(null)}>{t('arch.ai.discard')}</Button>
                  <Button onClick={apply} disabled={!changes.some((c) => pick[c.key])}>{t('arch.ai.apply')}</Button>
                </div>
              </>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
