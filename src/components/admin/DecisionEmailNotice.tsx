import { createElement, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { safeRpc } from '@/lib/safeRpc';
import { decisionNoticeState, type DecisionRecipient } from '@/lib/adminMessageEmail';
import {
  badgeFor, buildMessageView, DECISION_COPY, renderAdminMessage, type DecisionOutcome, type DecisionSubject, type Lang,
} from '../../../supabase/functions/_shared/adminMessageEmail';

const SITE = 'https://www.aisupport360.com';

/**
 * The line next to every decision comment box: "This comment will also be e-mailed to <address>" (or why it will not
 * be), always on for decisions, plus a live preview of the real e-mail in English / Arabic. The address comes from the
 * administrators-only admin_decision_recipient RPC; the e-mail itself is sent only by the database (ame_decision_notice).
 */
export default function DecisionEmailNotice({ userId, consultantId, subject, outcomes, comment, link, label, compact, className }: {
  userId?: string | null; consultantId?: string | null; subject: DecisionSubject; outcomes: DecisionOutcome[];
  comment?: string; link?: string; label?: string; compact?: boolean; className?: string;
}) {
  const { t, i18n } = useTranslation();
  const q = useQuery({
    queryKey: ['admin-decision-recipient', userId ?? null, consultantId ?? null],
    enabled: !!(userId || consultantId),
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<DecisionRecipient | null> => {
      const { data, error } = await safeRpc<DecisionRecipient>('admin_decision_recipient', { _user: userId ?? null, _consultant: consultantId ?? null });
      return error ? null : data;
    },
  });
  const state = decisionNoticeState(q.data ?? null);
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Lang>(i18n.language?.startsWith('ar') ? 'ar' : 'en');
  const [outcome, setOutcome] = useState<DecisionOutcome>(outcomes[0]);
  useEffect(() => { if (!outcomes.includes(outcome)) setOutcome(outcomes[0]); }, [outcomes, outcome]);
  useEffect(() => { if (q.data?.lang === 'ar' || q.data?.lang === 'en') setLang(q.data.lang); }, [q.data?.lang]);

  const line = state.kind === 'send'
    ? t('ame.decision_line', 'This comment will also be e-mailed to {{to}}.', { to: state.email })
    : state.kind === 'unknown'
      ? t('ame.decision_line_generic', 'This comment will also be e-mailed to the address on this profile.')
      : t(`ame.decision_skip_${state.kind}`, {
        no_email: 'No e-mail address on this profile: the decision shows in-app only and is recorded as "no e-mail".',
        not_confirmed: 'The e-mail address {{to}} is not confirmed yet: the decision shows in-app and is recorded as not e-mailed.',
        test: 'Test account: the decision shows in-app only (recorded as "test account").',
        suppressed: 'E-mails to {{to}} are blocked (bounce or unsubscribe): the decision shows in-app and is recorded.',
        off: 'Admin e-mails are switched off in settings: the decision shows in-app and is recorded as not e-mailed.',
      }[state.kind], { to: state.email ?? '' });

  return (
    <div className={cn('space-y-2 text-xs', className)} data-testid="decision-email-notice">
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <p className={cn('flex min-w-0 flex-1 items-start gap-1.5', state.kind === 'send' || state.kind === 'unknown' ? 'text-muted-foreground' : 'text-warning')} role="note" aria-live="polite">
          {state.kind === 'send' || state.kind === 'unknown'
            ? <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="min-w-0 break-words">
            {compact && state.kind === 'send' ? t('ame.decision_line_compact', 'Your decision is also e-mailed to {{to}}.', { to: state.email }) : line}{' '}
            <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Lock className="h-3 w-3" aria-hidden />{t('ame.decision_locked', 'Always on for decisions.')}</span>
          </span>
        </p>
        {!compact && (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <EyeOff className="me-1 h-3.5 w-3.5" aria-hidden /> : <Eye className="me-1 h-3.5 w-3.5" aria-hidden />}
            {open ? t('ame.decision_hide_preview', 'Hide preview') : t('ame.decision_preview', 'Preview e-mail')}
          </Button>
        )}
      </div>
      {!compact && open && (
        <DecisionPreview subject={subject} outcome={outcome} outcomes={outcomes} setOutcome={setOutcome} lang={lang} setLang={setLang}
          comment={comment} link={link} label={label} />
      )}
    </div>
  );
}

function DecisionPreview({ subject, outcome, outcomes, setOutcome, lang, setLang, comment, link, label }: {
  subject: DecisionSubject; outcome: DecisionOutcome; outcomes: DecisionOutcome[]; setOutcome: (o: DecisionOutcome) => void;
  lang: Lang; setLang: (l: Lang) => void; comment?: string; link?: string; label?: string;
}) {
  const { t } = useTranslation();
  const [html, setHtml] = useState('');
  const view = useMemo(() => buildMessageView({
    title: '', body: '', link: link ?? '/notifications', type: 'approval', created_at: new Date().toISOString(),
    meta: { v: 1, category: 'decision', context: label ? { kind: 'other', label } : null, decision: { subject, outcome, comment: comment ?? '' } },
  }, SITE, lang), [subject, outcome, comment, link, label, lang]);
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => {
      import('react-dom/server.browser').then(({ renderToStaticMarkup }) => {
        if (!live) return;
        const data = { lang, digest: false, items: [view], url: view.url, inboxUrl: `${SITE}/notifications`, prefsUrl: `${SITE}/notifications/pause`, helpHref: 'mailto:info@aisupport360.com' };
        setHtml('<!DOCTYPE html>' + renderToStaticMarkup(renderAdminMessage(createElement as never, data) as ReactElement));
      });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [view, lang]);
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t('ame.decision_preview', 'Preview e-mail')}>
        {outcomes.length > 1 && outcomes.map((o) => (
          <Button key={o} type="button" size="sm" variant={o === outcome ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" aria-pressed={o === outcome} onClick={() => setOutcome(o)}>
            {DECISION_COPY[lang].badges[badgeFor(o)]}
          </Button>
        ))}
        <span className="ms-auto inline-flex gap-1">
          {(['en', 'ar'] as const).map((l) => (
            <Button key={l} type="button" size="sm" variant={l === lang ? 'secondary' : 'ghost'} className="h-7 px-2 text-xs" aria-pressed={l === lang} onClick={() => setLang(l)}>
              {l === 'en' ? 'English' : 'العربية'}
            </Button>
          ))}
        </span>
      </div>
      <iframe title={t('ame.decision_preview', 'Preview e-mail')} sandbox="" srcDoc={html} className="h-[520px] w-full rounded-xl border border-border bg-card" />
    </div>
  );
}
