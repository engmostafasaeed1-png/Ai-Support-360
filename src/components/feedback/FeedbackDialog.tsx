import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, ImagePlus, Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUserProfile } from '@/hooks/useUserProfile';
import { cn } from '@/lib/utils';
import {
  buildFeedbackContext, canCaptureScreen, captureScreen, checkImage, FEEDBACK_LIMITS, FEEDBACK_SEVERITIES, FEEDBACK_TYPES,
  feedbackErrorKey, stripImageMetadata, submitFeedback, validateFeedback,
  type FeedbackSeverity, type FeedbackType,
} from '@/lib/feedback';

interface Props { open: boolean; onOpenChange: (open: boolean) => void; signedIn: boolean }

const TYPE_LABEL: Record<FeedbackType, string> = { bug: 'Bug', idea: 'Improvement idea', question: 'Question', compliment: 'Compliment' };
const SEVERITY_LABEL: Record<FeedbackSeverity, string> = { blocks: 'Blocks me', annoying: 'Annoying', minor: 'Minor' };

function roleFromPath(path: string, signedIn: boolean): string {
  if (!signedIn) return 'visitor';
  if (path.startsWith('/super-admin')) return 'super admin';
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/consultant')) return 'consultant';
  if (path.startsWith('/client')) return 'client';
  return 'signed in';
}

function Chips<T extends string>({ label, options, value, onChange, labels, tKey, error }: {
  label: string; options: readonly T[]; value: T | ''; onChange: (v: T) => void; labels: Record<T, string>; tKey: string; error?: string;
}) {
  const { t } = useTranslation();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (i: number, delta: number) => {
    const n = (i + delta + options.length) % options.length;
    onChange(options[n]);
    refs.current[n]?.focus();
  };
  return (
    <div>
      <p id={`${tKey}-label`} className="mb-1.5 text-sm font-medium">{label}</p>
      <div role="radiogroup" aria-labelledby={`${tKey}-label`} aria-invalid={!!error || undefined} className="flex flex-wrap gap-2">
        {options.map((o, i) => {
          const active = value === o;
          return (
            <button
              key={o}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active || (!value && i === 0) ? 0 : -1}
              onClick={() => onChange(o)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, document.dir === 'rtl' && e.key === 'ArrowRight' ? -1 : 1); }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, document.dir === 'rtl' && e.key === 'ArrowLeft' ? 1 : -1); }
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted',
              )}
            >
              {String(t(`feedback.${tKey}.${o}`, { defaultValue: labels[o] }))}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function FeedbackDialog({ open, onOpenChange, signedIn }: Props) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const { profile } = useUserProfile();

  const [type, setType] = useState<FeedbackType | ''>('');
  const [severity, setSeverity] = useState<FeedbackSeverity | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [consent, setConsent] = useState(signedIn);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const [website, setWebsite] = useState('');
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState('');
  const [done, setDone] = useState<{ screenshotsFailed: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const openedAt = useRef(Date.now());
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { openedAt.current = Date.now(); setServerError(''); }
  }, [open]);
  useEffect(() => { if (profile?.email && !email) setEmail(profile.email); }, [profile?.email]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setConsent(signedIn); }, [signedIn]);

  const role = roleFromPath(pathname, signedIn);
  const context = useMemo(() => (open ? buildFeedbackContext(role, i18n.language) : null), [open, role, i18n.language, pathname]);
  const errors = validateFeedback({ type, severity, title, description, contactEmail: email });
  const msg = (field: keyof typeof errors) => {
    const e = errors[field];
    if (!touched || !e) return undefined;
    const map: Record<string, string> = {
      required: 'This is required.',
      too_short: field === 'title' ? `At least ${FEEDBACK_LIMITS.titleMin} characters.` : `At least ${FEEDBACK_LIMITS.descMin} characters.`,
      too_long: 'This is too long.',
      invalid: field === 'contactEmail' ? 'Enter a valid e-mail address or leave it empty.' : 'Choose one of the options.',
    };
    return String(t(`feedback.error.${field}_${e}`, { defaultValue: map[e] }));
  };

  const reset = () => {
    setType(''); setSeverity(null); setTitle(''); setDescription(''); setFiles([]); setFileError(''); setTouched(false);
    setServerError(''); setDone(null); setWebsite('');
  };

  const addFiles = async (list: File[]) => {
    setFileError('');
    const room = FEEDBACK_LIMITS.files - files.length;
    if (list.length > room) setFileError(String(t('feedback.files.count', { defaultValue: 'You can attach up to 3 images.' })));
    const accepted: File[] = [];
    for (const f of list.slice(0, Math.max(room, 0))) {
      const problem = await checkImage(f);
      if (problem === 'size') { setFileError(String(t('feedback.files.size', { defaultValue: 'Each image must be 5 MB or smaller.' }))); continue; }
      if (problem === 'type') { setFileError(String(t('feedback.files.type', { defaultValue: 'Only PNG, JPG or WebP images.' }))); continue; }
      accepted.push(await stripImageMetadata(f));
    }
    if (accepted.length) setFiles((prev) => [...prev, ...accepted].slice(0, FEEDBACK_LIMITS.files));
  };

  const onCapture = async () => {
    setCapturing(true);
    try {
      const shot = await captureScreen();
      if (shot) await addFiles([shot]);
    } catch { /* the person cancelled the browser prompt */ }
    finally { setCapturing(false); }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || !type || !context || sending) return;
    setSending(true);
    setServerError('');
    const res = await submitFeedback({
      type, severity, title, description, contactEmail: consent ? email : '', consentContact: consent,
      context, files, website, elapsedMs: Date.now() - openedAt.current,
    });
    setSending(false);
    if (res.ok) { setDone({ screenshotsFailed: res.screenshotsFailed ?? 0 }); return; }
    const key = feedbackErrorKey(res.error ?? '');
    const copy: Record<string, string> = {
      rate_limited: 'You have sent several reports in the last hour. Please try again a little later.',
      disabled: 'Feedback is switched off at the moment.',
      too_fast: 'Please take a moment to check your report, then send it again.',
      invalid: 'Please check the highlighted fields and images.',
      generic: 'Your report could not be sent. Please try again.',
    };
    setServerError(String(t(`feedback.server.${key}`, { defaultValue: copy[key] })));
  };

  const heading = String(t('feedback.title', { defaultValue: 'Send feedback' }));
  const sub = String(t('feedback.subtitle', { defaultValue: 'Report a problem, suggest an improvement or ask a question. The team reads every report.' }));
  const contextRows: Array<[string, string]> = context ? [
    [String(t('feedback.ctx.page', { defaultValue: 'Page' })), context.path],
    [String(t('feedback.ctx.version', { defaultValue: 'App version' })), context.version],
    [String(t('feedback.ctx.language', { defaultValue: 'Language / theme' })), `${context.lang} / ${context.theme}`],
    [String(t('feedback.ctx.screen', { defaultValue: 'Screen size' })), context.viewport],
    [String(t('feedback.ctx.browser', { defaultValue: 'Browser' })), `${context.browser} · ${context.os}`],
    [String(t('feedback.ctx.role', { defaultValue: 'Signed in as' })), context.role],
    [String(t('feedback.ctx.errors', { defaultValue: 'Recent errors on this device' })), context.errors.length ? String(context.errors.length) : '0'],
  ] : [];

  const body = done ? (
    <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
      <CheckCircle2 aria-hidden="true" className="h-10 w-10 text-success" />
      <p className="text-lg font-semibold">{String(t('feedback.done.title', { defaultValue: 'Thank you — we received it' }))}</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        {signedIn
          ? String(t('feedback.done.signed_in', { defaultValue: 'You can follow the status and our replies under My feedback.' }))
          : String(t('feedback.done.visitor', { defaultValue: 'If you left an e-mail address and allowed contact, we may reply there.' }))}
      </p>
      {done.screenshotsFailed > 0 && (
        <p className="text-xs text-muted-foreground">{String(t('feedback.done.screens_failed', { defaultValue: 'Some images could not be saved, but your report was sent.' }))}</p>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {signedIn && (
          <Button asChild variant="outline"><Link to="/my-feedback" onClick={() => onOpenChange(false)}>{String(t('feedback.my', { defaultValue: 'My feedback' }))}</Link></Button>
        )}
        <Button variant="outline" onClick={reset}>{String(t('feedback.done.another', { defaultValue: 'Send another' }))}</Button>
        <Button onClick={() => { reset(); onOpenChange(false); }}>{String(t('common.close', { defaultValue: 'Close' }))}</Button>
      </div>
    </div>
  ) : (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Chips label={String(t('feedback.type_label', { defaultValue: 'What is it about?' }))} options={FEEDBACK_TYPES} value={type}
        onChange={(v) => { setType(v); if (v !== 'bug') setSeverity(null); }} labels={TYPE_LABEL} tKey="type" error={msg('type')} />
      {type === 'bug' && (
        <Chips label={String(t('feedback.severity_label', { defaultValue: 'How bad is it?' }))} options={FEEDBACK_SEVERITIES}
          value={severity ?? ''} onChange={setSeverity} labels={SEVERITY_LABEL} tKey="severity" />
      )}

      <div className="space-y-1.5">
        <Label htmlFor="fb-title">{String(t('feedback.title_label', { defaultValue: 'Short title' }))} <span aria-hidden="true">*</span></Label>
        <Input id="fb-title" value={title} maxLength={FEEDBACK_LIMITS.titleMax} onChange={(e) => setTitle(e.target.value)} required
          aria-invalid={!!msg('title') || undefined} aria-describedby={msg('title') ? 'fb-title-err' : undefined} />
        {msg('title') && <p id="fb-title-err" className="text-xs text-destructive">{msg('title')}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="fb-desc">{String(t('feedback.desc_label', { defaultValue: 'Description' }))} <span aria-hidden="true">*</span></Label>
        <Textarea id="fb-desc" rows={5} value={description} maxLength={FEEDBACK_LIMITS.descMax} onChange={(e) => setDescription(e.target.value)} required
          aria-invalid={!!msg('description') || undefined} aria-describedby="fb-desc-help fb-desc-count" />
        <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span id="fb-desc-help">{String(t('feedback.desc_help', { defaultValue: 'What happened? What did you expect? Steps to reproduce' }))}</span>
          <span id="fb-desc-count" className="shrink-0 tabular-nums">{description.length}/{FEEDBACK_LIMITS.descMax}</span>
        </div>
        {msg('description') && <p className="text-xs text-destructive">{msg('description')}</p>}
      </div>

      <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-foreground" role="note">
        <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span>{String(t('feedback.warning', { defaultValue: 'Do not include passwords, bank details or confidential client data. Long codes and card numbers are hidden automatically.' }))}</span>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{String(t('feedback.files.label', { defaultValue: 'Screenshots (optional, up to 3)' }))}</p>
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
            onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          <Button type="button" variant="outline" size="sm" disabled={files.length >= FEEDBACK_LIMITS.files} onClick={() => fileInput.current?.click()}>
            <ImagePlus aria-hidden="true" className="me-1.5 h-4 w-4" />{String(t('feedback.files.add', { defaultValue: 'Add image' }))}
          </Button>
          {canCaptureScreen() && !isMobile && (
            <Button type="button" variant="outline" size="sm" disabled={capturing || files.length >= FEEDBACK_LIMITS.files} onClick={() => void onCapture()}>
              {capturing ? <Loader2 aria-hidden="true" className="me-1.5 h-4 w-4 animate-spin" /> : <Camera aria-hidden="true" className="me-1.5 h-4 w-4" />}
              {String(t('feedback.files.capture', { defaultValue: 'Capture this screen' }))}
            </Button>
          )}
        </div>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label={String(t('feedback.files.list', { defaultValue: 'Attached images' }))}>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1 text-xs">
                <span className="max-w-[10rem] truncate">{f.name}</span>
                <span className="text-muted-foreground">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                <button type="button" className="rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={String(t('feedback.files.remove', { defaultValue: 'Remove {{name}}', name: f.name }))}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {fileError && <p className="text-xs text-destructive" role="alert">{fileError}</p>}
        <p className="text-xs text-muted-foreground">{String(t('feedback.files.help', { defaultValue: 'PNG, JPG or WebP, 5 MB each. Location and camera details are removed before sending.' }))}</p>
      </div>

      <div className="space-y-2 rounded-xl border border-border/60 p-3">
        <div className="flex items-start gap-2">
          <Checkbox id="fb-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
          <Label htmlFor="fb-consent" className="text-sm font-normal leading-snug">{String(t('feedback.consent', { defaultValue: 'You may contact me about this' }))}</Label>
        </div>
        {consent && (
          <div className="space-y-1.5">
            <Label htmlFor="fb-email" className="text-xs">{String(t('feedback.email_label', { defaultValue: 'Contact e-mail (optional)' }))}</Label>
            <Input id="fb-email" type="email" inputMode="email" autoComplete="email" value={email} maxLength={FEEDBACK_LIMITS.emailMax}
              onChange={(e) => setEmail(e.target.value)} aria-invalid={!!msg('contactEmail') || undefined} />
            {msg('contactEmail') && <p className="text-xs text-destructive">{msg('contactEmail')}</p>}
          </div>
        )}
      </div>

      {/* Spam trap: invisible to people and screen readers. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="fb-website">Website</label>
        <input id="fb-website" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>

      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg px-1 py-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {String(t('feedback.ctx.title', { defaultValue: 'What we attach' }))}
          <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-muted/40 p-3 text-xs">
            {contextRows.map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="break-all" dir="auto">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {String(t('feedback.ctx.note', { defaultValue: 'Also the time, and for signed-in users your account and organisation (kept on our side, not shown here). Never passwords.' }))}{' '}
            <Link to="/privacy-policy" className="underline underline-offset-2" target="_blank" rel="noopener">{String(t('feedback.privacy', { defaultValue: 'Privacy policy' }))}</Link>
          </p>
        </CollapsibleContent>
      </Collapsible>

      {serverError && <p className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive" role="alert">{serverError}</p>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{String(t('common.cancel', { defaultValue: 'Cancel' }))}</Button>
        <Button type="submit" disabled={sending}>
          {sending && <Loader2 aria-hidden="true" className="me-1.5 h-4 w-4 animate-spin" />}
          {String(t('feedback.send', { defaultValue: 'Send' }))}
        </Button>
      </div>
    </form>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="mb-3 text-start">
            <SheetTitle>{heading}</SheetTitle>
            <SheetDescription>{sub}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader className="text-start">
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{sub}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}
