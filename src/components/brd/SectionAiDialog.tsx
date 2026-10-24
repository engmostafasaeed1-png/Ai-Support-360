import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { runBrdAi, type AiReport, type AiStep } from '@/lib/brd/api';
import { DiffOps } from './BrdDiffView';
import { announceReport, aiErrorText } from './aiFeedback';
import { diffText } from '../../../supabase/functions/_shared/brdDiff';
import { htmlToText, SECTION_TITLES, type BrdContent, type BrdRequirement, type SectionKey } from '../../../supabase/functions/_shared/brdModel';
import type { IncludeFlags } from '../../../supabase/functions/_shared/brdTicketParts';

export type SectionAiMode = 'regenerate' | 'improve' | 'shorter';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ticketId: string;
  content: BrdContent;
  section: SectionKey;
  mode: SectionAiMode;
  deep: boolean;
  include: IncludeFlags;
  onAccept: (patch: { html: string; html_ar?: string; requirements?: BrdRequirement[] | null }) => void;
}

/** Asks the AI for one section and shows a word-level diff; nothing changes until the client presses Accept. */
export default function SectionAiDialog({ open, onOpenChange, ticketId, content, section, mode, deep, include, onAccept }: Props) {
  const { t, i18n } = useTranslation();
  const lang = content.language === 'ar' ? 'ar' : 'en';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const current = content.sections.find((s) => s.key === section);
  const [busy, setBusy] = useState(false);
  const [stepLabel, setStepLabel] = useState<AiStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ html: string; html_ar?: string; requirements: Array<Omit<BrdRequirement, 'id' | 'status' | 'owner'>> | null; report: AiReport } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    abort.current = new AbortController();
    const { result: r, error: e } = await runBrdAi<{ html: string; html_ar?: string; requirements: any[] | null }>({
      action: 'section', ticketId, language: content.language, section, mode, deep,
      currentHtml: current?.html ?? '', currentHtmlAr: current?.html_ar ?? '', include, attachments: [],
    }, setStepLabel, abort.current.signal);
    setBusy(false);
    if (e || !r) { setError(aiErrorText(t, e ?? { code: 'error', status: 500, message: '' })); return; }
    setResult(r as any);
  };

  const close = (o: boolean) => {
    if (!o) { abort.current?.abort(); setResult(null); setError(null); setBusy(false); }
    onOpenChange(o);
  };

  const title = t(`brd.ai.mode_${mode}`) + (deep ? ` · ${t('brd.ai.deep')}` : '');
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{SECTION_TITLES[section][i18n.language?.startsWith('ar') ? 'ar' : 'en']}</DialogDescription>
        </DialogHeader>
        {!result && !busy && !error && <p className="text-sm text-muted-foreground">{t('brd.ai.confirmIntro')}</p>}
        {busy && <p className="flex items-center gap-2 text-sm" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" /> {t(`brd.ai.step_${stepLabel ?? 'reading'}`)}</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {result && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('brd.ai.diffIntro')}</p>
            <div className="rounded-xl border border-border p-3"><DiffOps ops={diffText(htmlToText(current?.html ?? ''), htmlToText(result.html))} dir={dir} /></div>
            {content.language === 'both' && result.html_ar !== undefined && (
              <div className="rounded-xl border border-border p-3"><DiffOps ops={diffText(htmlToText(current?.html_ar ?? ''), htmlToText(result.html_ar ?? ''))} dir="rtl" /></div>
            )}
            {result.requirements && <p className="text-xs">{t('brd.ai.reqsIncluded', { count: result.requirements.length })}</p>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {busy ? <Button variant="outline" onClick={() => abort.current?.abort()}>{t('brd.wizard.stop')}</Button> : (
            <>
              <Button variant="ghost" onClick={() => close(false)}>{result ? t('brd.ai.reject') : t('common.cancel', 'Cancel')}</Button>
              {!result && <Button onClick={run}>{t('brd.ai.run')}</Button>}
              {result && (
                <Button onClick={() => {
                  announceReport(t, result.report);
                  onAccept({
                    html: result.html, ...(result.html_ar !== undefined ? { html_ar: result.html_ar } : {}),
                    requirements: result.requirements
                      ? result.requirements.map((r, i) => ({ id: `REQ-${String(i + 1).padStart(3, '0')}`, status: 'proposed', owner: '', ...r }) as BrdRequirement)
                      : null,
                  });
                  close(false);
                }}>{t('brd.ai.accept')}</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
