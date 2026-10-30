import { createElement, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Bold, Link as LinkIcon, List, Send, FlaskConical, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { callRpc, NotInstalledError } from '@/hooks/useUserAdmin';
import { useBulkActions, useTemplates } from '@/hooks/useBulkMessaging';
import AdminEmailChoice, { DEFAULT_ADMIN_EMAIL, type AdminEmailValue } from './AdminEmailChoice';
import MessageCard from '@/components/messages/MessageCard';
import { canUntickCategory, fillTemplateVars, firstNameOf, LIMITS, TEMPLATE_VARS } from '@/lib/adminMessageEmail';
import {
  buildMessageView, MESSAGE_CATEGORIES, MESSAGE_COPY, renderAdminMessage, safeHref, type Lang, type MessageCategory, type MessageContext,
} from '../../../supabase/functions/_shared/adminMessageEmail';

const SITE = 'https://www.aisupport360.com';
const PATH_RE = /^\/(?!\/)[A-Za-z0-9/_?=&.#%-]{0,199}$/;
type CtxKind = 'none' | 'ticket' | 'agreement' | 'invoice' | 'other';

export interface ComposeRecipient { id: string; name: string; email?: string }
export interface ComposeFallback { (v: { title: string; body: string; link: string }, emailHeader?: string): Promise<unknown> | void }

/**
 * The one admin compose box for writing to one person: category, subject, summary, rich-text-lite body (bold, bullets,
 * links to our own site), related item, what to do + deadline, saved templates with {first_name} {ticket} {link},
 * "Also send by e-mail", live preview (in-app card / e-mail, EN/AR, light/dark), send confirmation and "Send test to me".
 * Sends through admin_message_send (docs/sql/admin-message-email.sql); before that update it falls back to the plain notice.
 */
export default function AdminMessageComposer({ recipient, onSent, onCancel, fallbackSend }: {
  recipient: ComposeRecipient; onSent: () => void; onCancel: () => void; fallbackSend?: ComposeFallback;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<MessageCategory>('notice');
  const [subject, setSubject] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [action, setAction] = useState('');
  const [deadline, setDeadline] = useState('');
  const [ctxKind, setCtxKind] = useState<CtxKind>('none');
  const [ctxRef, setCtxRef] = useState('');
  const [ctxLabel, setCtxLabel] = useState('');
  const [ctxStatus, setCtxStatus] = useState('');
  const [ctx, setCtx] = useState<{ value: MessageContext | null; error?: string }>({ value: null });
  const [email, setEmail] = useState<AdminEmailValue>(DEFAULT_ADMIN_EMAIL);
  const [lang, setLang] = useState<Lang>('en');
  const [dark, setDark] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<'send' | 'test' | 'tpl' | null>(null);
  const [html, setHtml] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const templates = useTemplates(true);
  const { saveTemplate } = useBulkActions();

  const vars = { first_name: firstNameOf(recipient.name), ticket: ctx.value?.ref || ctx.value?.label || '', link: link ? `${SITE}${link}` : '' };
  const fill = (s: string) => fillTemplateVars(s, vars);
  const linkBad = !!link && !PATH_RE.test(link);
  const today = new Date().toISOString().slice(0, 10);
  const deadlineBad = !!deadline && deadline < today;
  const emailLocked = !canUntickCategory(category);
  const sendEmail = emailLocked || email.email;

  // Related item: resolved by the database for this recipient (only their own ticket / agreement / invoice).
  useEffect(() => {
    if (ctxKind === 'none') { setCtx({ value: null }); return; }
    if (ctxKind === 'other') { setCtx({ value: ctxLabel.trim() ? { kind: 'other', label: ctxLabel.trim(), ref: ctxRef.trim() || undefined, status: ctxStatus.trim() || undefined } : null }); return; }
    if (!ctxRef.trim()) { setCtx({ value: null }); return; }
    const h = setTimeout(async () => {
      try {
        const v = await callRpc<MessageContext>('admin_message_context', { _to: recipient.id, _kind: ctxKind, _ref: ctxRef.trim() });
        setCtx({ value: v });
      } catch (e) {
        const m = (e as Error).message;
        setCtx({ value: null, error: e instanceof NotInstalledError ? 'not_installed' : m.includes('not_for_recipient') ? 'not_theirs' : 'not_found' });
      }
    }, 350);
    return () => clearTimeout(h);
  }, [ctxKind, ctxRef, ctxLabel, ctxStatus, recipient.id]);

  const view = useMemo(() => buildMessageView({
    title: fill(subject) || t('amc.subject_placeholder', 'Subject'), body: fill(body) || '…', link: link && !linkBad ? link : '/notifications', type: 'admin_message',
    created_at: new Date().toISOString(),
    meta: { v: 1, category, summary: fill(summary), context: ctx.value, action_label: fill(action), deadline: deadline || undefined },
  }, SITE), [subject, body, link, linkBad, category, summary, ctx.value, action, deadline, recipient.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // E-mail preview: the real e-mail layout, rendered in the browser into a sandboxed frame.
  useEffect(() => {
    let live = true;
    import('react-dom/server').then(({ renderToStaticMarkup }) => {
      if (!live) return;
      const data = { lang, digest: false, items: [view], url: view.url, inboxUrl: `${SITE}/notifications`, prefsUrl: `${SITE}/notifications/pause`, helpHref: 'mailto:info@aisupport360.com' };
      setHtml('<!DOCTYPE html>' + renderToStaticMarkup(renderAdminMessage(createElement as never, data) as ReactElement));
    });
    return () => { live = false; };
  }, [view, lang]);

  function wrap(kind: 'bold' | 'bullet' | 'link') {
    const el = bodyRef.current;
    const s = el?.selectionStart ?? body.length, e = el?.selectionEnd ?? body.length;
    const sel = body.slice(s, e);
    let ins = '';
    if (kind === 'bold') ins = `**${sel || t('amc.bold_text', 'important')}**`;
    if (kind === 'bullet') ins = (s > 0 && body[s - 1] !== '\n' ? '\n' : '') + (sel ? sel.split('\n').map((l) => `- ${l}`).join('\n') : '- ');
    if (kind === 'link') {
      const url = window.prompt(t('amc.link_prompt', 'Page on our site (for example /client/tickets)'), '/');
      if (!url) return;
      if (!safeHref(url, SITE)) { toast.error(t('amc.link_only_ours', 'Links can only point to pages on aisupport360.com.')); return; }
      ins = `[${sel || t('amc.link_text', 'open')}](${url})`;
    }
    const next = body.slice(0, s) + ins + body.slice(e);
    setBody(next.slice(0, LIMITS.body));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + ins.length, s + ins.length); });
  }

  function applyTemplate(id: string) {
    const tpl = templates.data?.find((x) => x.id === id);
    if (!tpl) return;
    const ar = lang === 'ar' && tpl.body_ar;
    setSubject((ar ? tpl.subject_ar : tpl.subject_en) ?? '');
    setBody((ar ? tpl.body_ar : tpl.body_en) ?? '');
    if (tpl.link_url?.startsWith('/')) setLink(tpl.link_url);
  }

  const payload = (test: boolean) => ({
    category, subject: fill(subject).trim(), summary: fill(summary).trim(), body: fill(body).trim(), link: link.trim(), action_label: fill(action).trim(),
    deadline: deadline || null, email: sendEmail, important: email.important, tests: email.includeTests, test,
    context: ctxKind === 'none' ? null : { kind: ctxKind, ref: ctxRef.trim(), label: ctxLabel.trim(), status: ctxStatus.trim() },
  });

  async function send(test: boolean) {
    setBusy(test ? 'test' : 'send');
    try {
      const r = await callRpc<{ email?: { status: string; reason: string | null } }>('admin_message_send', { _to: recipient.id, _p: payload(test) });
      if (test) toast.success(t('amc.test_sent', 'Test sent to you (in-app and e-mail).'));
      else {
        toast.success(r.email?.status === 'queued' ? t('amc.sent_email', 'Sent in-app and queued for e-mail.') : t('amc.sent_inapp', 'Sent in-app.'));
        onSent();
      }
    } catch (e) {
      if (e instanceof NotInstalledError) {
        if (test) toast.error(t('amc.needs_update', 'This needs the prepared database update.'));
        else if (fallbackSend) { await fallbackSend({ title: fill(subject).trim(), body: fill(body).trim(), link: link.trim() }); onSent(); }
      } else toast.error((e as Error).message);
    } finally { setBusy(null); setConfirm(false); }
  }

  async function saveAsTemplate() {
    const name = window.prompt(t('amc.tpl_name', 'Template name'), subject.slice(0, 60));
    if (!name?.trim()) return;
    setBusy('tpl');
    try { await saveTemplate.mutateAsync({ name: name.trim(), category: 'service', subject_en: subject, body_en: body, link_url: link || null }); toast.success(t('amc.tpl_saved', 'Template saved')); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }

  const count = (n: number, max: number, tip: number) => (
    <span className={cn('text-[11px] tabular-nums', n > max ? 'text-destructive' : n > tip ? 'text-warning' : 'text-muted-foreground')}>{n}/{max}</span>
  );
  const blockers = [
    !subject.trim() && 'type_message_first', !body.trim() && 'type_message_first',
    (subject.length > LIMITS.subject || summary.length > LIMITS.summary || body.length > LIMITS.body || action.length > LIMITS.action) && 'invalid_value',
    linkBad && 'invalid_value', deadlineBad && 'invalid_value', !!ctx.error && ctxKind !== 'other' && 'invalid_value',
  ] as const;
  const c = MESSAGE_COPY.en;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('amc.to', 'To')}</span>
          <Badge variant="secondary" className="gap-1 rounded-full py-1 font-normal">{recipient.name || recipient.email}{recipient.email && recipient.name ? <span className="text-muted-foreground">· {recipient.email}</span> : null}</Badge>
          {!!templates.data?.length && (
            <Select onValueChange={applyTemplate}>
              <SelectTrigger className="ms-auto h-8 w-48 text-xs" aria-label={t('amc.template', 'Use a template')}><SelectValue placeholder={t('amc.template', 'Use a template')} /></SelectTrigger>
              <SelectContent>{templates.data.map((tpl) => <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
          <div className="space-y-1">
            <Label htmlFor="amc-cat">{t('amc.category', 'Category')}</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as MessageCategory)}>
              <SelectTrigger id="amc-cat"><SelectValue /></SelectTrigger>
              <SelectContent>{MESSAGE_CATEGORIES.map((k) => <SelectItem key={k} value={k}>{t(`amc.cat_${k}`, c.categories[k])}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between"><Label htmlFor="amc-subj">{t('amc.subject', 'Subject')}</Label>{count(subject.length, LIMITS.subject, LIMITS.subjectTip)}</div>
            <Input id="amc-subj" value={subject} maxLength={LIMITS.subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('amc.subject_hint', 'Short and clear, e.g. "Please confirm your payout details"')} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between"><Label htmlFor="amc-sum">{t('amc.summary', 'One-line summary (optional)')}</Label>{count(summary.length, LIMITS.summary, LIMITS.summaryTip)}</div>
          <Input id="amc-sum" value={summary} maxLength={LIMITS.summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="amc-body">{t('amc.body', 'Message')}</Label>
            <div className="flex items-center gap-1" role="toolbar" aria-label={t('amc.format', 'Formatting')}>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => wrap('bold')} aria-label={t('amc.bold', 'Bold')}><Bold className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => wrap('bullet')} aria-label={t('amc.bullets', 'Bullet list')}><List className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => wrap('link')} aria-label={t('amc.link', 'Link to a page on our site')}><LinkIcon className="h-4 w-4" /></Button>
              {count(body.length, LIMITS.body, LIMITS.bodyTip)}
            </div>
          </div>
          <Textarea id="amc-body" ref={bodyRef} rows={8} value={body} maxLength={LIMITS.body} onChange={(e) => setBody(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">{t('amc.body_tip', 'Short paragraphs; start lines with "- " for bullets. Variables: {{vars}}.', { vars: TEMPLATE_VARS.map((v) => `{${v}}`).join(' ') })}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="amc-link">{t('amc.page', 'Button opens this page')}</Label>
            <Input id="amc-link" dir="ltr" value={link} placeholder="/client/tickets" onChange={(e) => setLink(e.target.value)} aria-invalid={linkBad} />
            {linkBad && <p className="text-[11px] text-destructive">{t('um.link_invalid', 'Use a page on this site starting with /.')}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="amc-dl">{t('amc.deadline', 'Deadline (optional)')}</Label>
            <Input id="amc-dl" type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} aria-invalid={deadlineBad} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between"><Label htmlFor="amc-act">{t('amc.todo', 'What they need to do (optional)')}</Label>{count(action.length, LIMITS.action, 80)}</div>
          <Input id="amc-act" value={action} maxLength={LIMITS.action} onChange={(e) => setAction(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
          <div className="space-y-1">
            <Label htmlFor="amc-ctx">{t('amc.related', 'Related item')}</Label>
            <Select value={ctxKind} onValueChange={(v) => setCtxKind(v as CtxKind)}>
              <SelectTrigger id="amc-ctx"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(['none', 'ticket', 'agreement', 'invoice', 'other'] as const).map((k) => <SelectItem key={k} value={k}>{t(`amc.ctx_${k}`, k === 'none' ? 'None' : c.contextKinds[k])}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {ctxKind !== 'none' && (
            <div className="space-y-1">
              <Label htmlFor="amc-ref">{ctxKind === 'other' ? t('amc.ctx_label', 'Name') : t('amc.ctx_ref', 'ID or reference')}</Label>
              {ctxKind === 'other'
                ? <div className="grid grid-cols-3 gap-2"><Input id="amc-ref" className="col-span-3 sm:col-span-1" value={ctxLabel} maxLength={120} onChange={(e) => setCtxLabel(e.target.value)} /><Input aria-label={t('amc.ctx_ref', 'ID or reference')} value={ctxRef} maxLength={40} placeholder="REF" onChange={(e) => setCtxRef(e.target.value)} /><Input aria-label={t('amc.ctx_status', 'Status')} value={ctxStatus} maxLength={40} placeholder={t('amc.ctx_status', 'Status')} onChange={(e) => setCtxStatus(e.target.value)} /></div>
                : <Input id="amc-ref" dir="ltr" value={ctxRef} onChange={(e) => setCtxRef(e.target.value)} placeholder={ctxKind === 'agreement' ? 'SA-2026-001' : ctxKind === 'invoice' ? 'INV-…' : 'ticket ID'} />}
              {ctx.error && <p className="text-[11px] text-destructive" role="alert">{t(`amc.ctx_err_${ctx.error}`, ctx.error === 'not_theirs' ? 'This item does not belong to this person.' : ctx.error === 'not_installed' ? 'Needs the prepared database update.' : 'Not found.')}</p>}
              {ctx.value && ctxKind !== 'other' && <p className="text-[11px] text-success">{ctx.value.label}{ctx.value.status ? ` · ${ctx.value.status}` : ''}</p>}
            </div>
          )}
        </div>
        <AdminEmailChoice type="admin_message" locked={emailLocked} value={email} onChange={setEmail} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}><X className="me-1 h-4 w-4" />{t('common.cancel', 'Cancel')}</Button>
          <Button type="button" variant="outline" size="sm" busy={busy === 'tpl'} reason={[!subject.trim() && 'type_message_first', !body.trim() && 'type_message_first']} onClick={saveAsTemplate}><Save className="me-1 h-4 w-4" />{t('amc.save_tpl', 'Save as template')}</Button>
          <Button type="button" variant="outline" size="sm" busy={busy === 'test'} reason={[...blockers]} onClick={() => send(true)}><FlaskConical className="me-1 h-4 w-4" />{t('amc.test', 'Send test to me')}</Button>
          <Button type="button" size="sm" busy={busy === 'send'} reason={[...blockers]} hint="inline" onClick={() => setConfirm(true)}><Send className="me-1 h-4 w-4" />{t('um.send', 'Send')}</Button>
        </div>
      </div>

      <section className="space-y-2" aria-label={t('amc.preview', 'Preview')}>
        <Tabs defaultValue="app">
          <div className="flex flex-wrap items-center gap-2">
            <TabsList><TabsTrigger value="app">{t('amc.preview_app', 'In-app card')}</TabsTrigger><TabsTrigger value="email">{t('amc.preview_email', 'E-mail')}</TabsTrigger></TabsList>
            <div className="ms-auto flex gap-1" role="group" aria-label={t('amc.preview_lang', 'Preview language')}>
              {(['en', 'ar'] as const).map((l) => <Button key={l} type="button" size="sm" variant={lang === l ? 'default' : 'outline'} aria-pressed={lang === l} onClick={() => setLang(l)}>{l === 'en' ? 'EN' : 'عربي'}</Button>)}
            </div>
            <div className="flex gap-1" role="group" aria-label={t('amc.preview_theme', 'Preview theme')}>
              <Button type="button" size="sm" variant={!dark ? 'default' : 'outline'} aria-pressed={!dark} onClick={() => setDark(false)}>{t('amc.light', 'Light')}</Button>
              <Button type="button" size="sm" variant={dark ? 'default' : 'outline'} aria-pressed={dark} onClick={() => setDark(true)}>{t('amc.dark', 'Dark')}</Button>
            </div>
          </div>
          <TabsContent value="app" className="mt-3">
            <div className={cn(dark && 'dark')}>
              <div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
                <MessageCard view={view} lang={lang} unread time={t('amc.just_now', 'just now')} onAction={() => undefined} defaultOpen />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="email" className="mt-3">
            <iframe title={t('amc.preview_email', 'E-mail')} sandbox="" srcDoc={html} className={cn('h-[640px] w-full rounded-2xl border border-border bg-card', dark && '[filter:invert(0.9)_hue-rotate(180deg)]')} />
            {!sendEmail && <p className="mt-1 text-[11px] text-muted-foreground">{t('amc.no_email_note', 'E-mail is unticked: this message is shown in-app only.')}</p>}
          </TabsContent>
        </Tabs>
      </section>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('amc.confirm_title', 'Send this message?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {sendEmail
                ? t('amc.confirm_email', 'To {{name}} in their notifications and by e-mail.', { name: recipient.name || recipient.email })
                : t('amc.confirm_inapp', 'To {{name}} in their notifications only.', { name: recipient.name || recipient.email })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); send(false); }}>{busy === 'send' ? t('amc.sending', 'Sending…') : t('um.send', 'Send')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
