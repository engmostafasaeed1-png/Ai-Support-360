import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Sparkles, ArrowRight, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import TaskProgressPanel from '@/components/progress/TaskProgressPanel';
import { makeSteps, setStep, type ProgressStep } from '@/lib/progressSteps';
import { useTicketDocuments } from '@/hooks/useTicketDocuments';
import { runBrdAi, type AiReport, type BrdState } from '@/lib/brd/api';
import { attachmentTexts } from '@/lib/brd/attachmentText';
import IncludePicker from './IncludePicker';
import { aiErrorText } from './aiFeedback';
import {
  BRD_LANGUAGES, BRD_TEMPLATES, TEMPLATE_TITLES, emptyContent,
  type BrdContent, type BrdLanguage, type BrdTemplate,
} from '../../../supabase/functions/_shared/brdModel';
import type { IncludeFlags } from '../../../supabase/functions/_shared/brdTicketParts';

interface Props {
  state: BrdState;
  onCreated: (content: BrdContent, report: AiReport | null) => void;
}

const STEP_ORDER = ['files', 'reading', 'writing', 'checking'] as const;

/** Step 1 language + template, step 2 what the AI may read, step 3 drafting progress; then the editor opens. */
export default function BrdWizard({ state, onCreated }: Props) {
  const { t, i18n } = useTranslation();
  const ticket = state.ticket!;
  const [step, setStepNo] = useState<1 | 2 | 3>(1);
  const [language, setLanguage] = useState<BrdLanguage>(i18n.language?.startsWith('ar') ? 'ar' : 'en');
  const [template, setTemplate] = useState<BrdTemplate>('standard');
  const [include, setInclude] = useState<IncludeFlags>({});
  const [files, setFiles] = useState<string[]>([]);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const { data: docs = [] } = useTicketDocuments(ticket.id);
  const maxFiles = state.settings?.max_attachments ?? 3;
  const maxChars = state.settings?.max_attachment_chars ?? 6000;

  const blank = () => emptyContent({
    language, template, title: ticket.title, ticketRef: ticket.ref, company: ticket.company ?? '', requester: ticket.requester ?? '',
  });

  const draft = async () => {
    setStepNo(3);
    setError(null);
    setStartedAt(Date.now());
    let s = makeSteps([
      { key: 'files', label: t('brd.wizard.stepFiles') },
      { key: 'reading', label: t('brd.wizard.stepReading') },
      { key: 'writing', label: t('brd.wizard.stepWriting'), open: true },
      { key: 'checking', label: t('brd.wizard.stepChecking') },
    ]);
    s = setStep(s, 'files', 'active');
    setSteps(s);
    const texts = include.attachments === false ? [] : await attachmentTexts(docs, files, maxChars);
    s = setStep(setStep(s, 'files', 'done', files.length ? t('brd.wizard.filesRead', { count: texts.length }) : undefined), 'reading', 'active');
    setSteps(s);
    abort.current = new AbortController();
    const advance = (to: (typeof STEP_ORDER)[number]) => {
      const idx = STEP_ORDER.indexOf(to);
      STEP_ORDER.forEach((k, i) => { if (i < idx) s = setStep(s, k, 'done'); });
      s = setStep(s, to, 'active');
      setSteps(s);
    };
    const { result, error: err } = await runBrdAi<{ content: BrdContent }>(
      { action: 'draft', ticketId: ticket.id, language, template, include, attachments: texts },
      (st) => advance(st === 'checking' ? 'checking' : st === 'reading' ? 'reading' : 'writing'),
      abort.current.signal,
    );
    if (err || !result) {
      const active = s.find((x) => x.state === 'active')?.key ?? 'writing';
      setSteps(setStep(s, active, 'error'));
      setError(aiErrorText(t, err ?? { code: 'error', status: 500, message: '' }));
      return;
    }
    STEP_ORDER.forEach((k) => { s = setStep(s, k, 'done'); });
    setSteps(s);
    onCreated(result.content, result.report);
  };

  return (
    <Card className="rounded-2xl border-border/50 max-w-3xl mx-auto">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2"><FileText className="h-5 w-5 text-accent" /> {t('brd.wizard.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('brd.wizard.subtitle')}</p>
        <ol className="flex gap-2 text-xs mt-2" aria-label={t('brd.wizard.progress')}>
          {[1, 2, 3].map((n) => (
            <li key={n} aria-current={step === n ? 'step' : undefined}
              className={`rounded-full px-2.5 py-0.5 ${step === n ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
              {t(`brd.wizard.step${n}`)}
            </li>
          ))}
        </ol>
      </CardHeader>
      <CardContent className="space-y-5">
        {step === 1 && (
          <>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">{t('brd.wizard.language')}</legend>
              <RadioGroup value={language} onValueChange={(v) => setLanguage(v as BrdLanguage)} className="flex flex-wrap gap-4">
                {BRD_LANGUAGES.map((l) => (
                  <div key={l} className="flex items-center gap-2"><RadioGroupItem id={`brd-lang-${l}`} value={l} /><Label htmlFor={`brd-lang-${l}`} className="font-normal">{t(`brd.lang.${l}`)}</Label></div>
                ))}
              </RadioGroup>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">{t('brd.wizard.template')}</legend>
              <RadioGroup value={template} onValueChange={(v) => setTemplate(v as BrdTemplate)} className="grid sm:grid-cols-2 gap-2">
                {BRD_TEMPLATES.map((tp) => (
                  <Label key={tp} htmlFor={`brd-tpl-${tp}`} className={`flex items-start gap-2 rounded-xl border p-3 cursor-pointer font-normal ${template === tp ? 'border-accent bg-accent/5' : 'border-border'}`}>
                    <RadioGroupItem id={`brd-tpl-${tp}`} value={tp} className="mt-0.5" />
                    <span><span className="block text-sm font-medium">{TEMPLATE_TITLES[tp][i18n.language?.startsWith('ar') ? 'ar' : 'en']}</span>
                      <span className="block text-xs text-muted-foreground">{t(`brd.template.${tp}`)}</span></span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
            <div className="flex justify-end"><Button onClick={() => setStepNo(2)} className="gap-1.5">{t('brd.wizard.next')} <ArrowRight className="h-4 w-4 rtl:rotate-180" /></Button></div>
          </>
        )}
        {step === 2 && (
          <>
            <IncludePicker ticketId={ticket.id} include={include} onInclude={setInclude} files={files} onFiles={setFiles} maxFiles={maxFiles} />
            <p className="text-xs text-muted-foreground rounded-lg bg-muted p-2">{t('brd.wizard.aiNote')}</p>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => setStepNo(1)} className="gap-1.5"><ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('brd.wizard.back')}</Button>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => onCreated(blank(), null)}>{t('brd.wizard.empty')}</Button>
                <Button onClick={draft} className="gap-1.5"><Sparkles className="h-4 w-4" /> {t('brd.wizard.draft')}</Button>
              </div>
            </div>
          </>
        )}
        {step === 3 && (
          <>
            <TaskProgressPanel title={t('brd.wizard.drafting')} steps={steps} startedAt={startedAt} error={error}
              onRetry={error ? draft : undefined}
              cancel={!error ? { label: t('brd.wizard.stop'), onClick: () => abort.current?.abort() } : undefined}
              note={t('brd.wizard.draftingNote')} />
            {error && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setStepNo(2)}>{t('brd.wizard.back')}</Button>
                <Button variant="outline" onClick={() => onCreated(blank(), null)}>{t('brd.wizard.empty')}</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
