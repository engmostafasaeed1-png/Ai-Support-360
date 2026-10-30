import { useState, type ReactNode } from 'react';
import { AlarmClock, CalendarClock, ClipboardCheck, Gavel, Link2, Megaphone, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DECISION_COPY, formatDeadline, MESSAGE_COPY, type DecisionBadge, OWN_HOSTS, type Block, type Inline, type Lang, type MessageCategory, type MessageView,
} from '../../../supabase/functions/_shared/adminMessageEmail';

/** Category colour and icon on design tokens (the e-mail uses the matching light colours). */
export const CATEGORY_UI: Record<MessageCategory, { icon: typeof Megaphone; chip: string; tile: string }> = {
  notice: { icon: Megaphone, chip: 'bg-info/10 text-info border-info/20', tile: 'bg-info/10 text-info' },
  decision: { icon: Gavel, chip: 'bg-primary/10 text-primary border-primary/20 dark:text-foreground', tile: 'bg-primary/10 text-primary dark:text-foreground' },
  action: { icon: ClipboardCheck, chip: 'bg-warning/15 text-warning border-warning/30', tile: 'bg-warning/15 text-warning' },
  reminder: { icon: AlarmClock, chip: 'bg-reminder/10 text-reminder border-reminder/25', tile: 'bg-reminder/10 text-reminder' },
  update: { icon: RefreshCw, chip: 'bg-muted text-muted-foreground border-border', tile: 'bg-muted text-muted-foreground' },
  welcome: { icon: Sparkles, chip: 'bg-success/10 text-success border-success/25', tile: 'bg-success/10 text-success' },
};

/** Decision status badge colours on design tokens (the e-mail uses DECISION_BADGE_COLOURS). */
const BADGE_UI: Record<DecisionBadge, string> = {
  approved: 'bg-success/10 text-success border-success/25', changes: 'bg-warning/15 text-warning border-warning/30',
  rejected: 'bg-destructive/10 text-destructive border-destructive/25', suspended: 'bg-destructive/10 text-destructive border-destructive/25',
  review: 'bg-info/10 text-info border-info/20',
};

/** Our own absolute links become in-app paths; everything else was already dropped by the shared formatter. */
export function inAppPath(url: string): string {
  try { const u = new URL(url); return OWN_HOSTS.includes(u.host) ? `${u.pathname}${u.search}${u.hash}` : '/notifications'; } catch { return url.startsWith('/') ? url : '/notifications'; }
}

function Inlines({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => {
    const body = p.bold ? <strong key={i} className="font-semibold text-foreground">{p.text}</strong> : <span key={i}>{p.text}</span>;
    return p.href ? <a key={i} href={inAppPath(p.href)} className="text-accent underline underline-offset-2" onClick={(e) => e.stopPropagation()}>{body}</a> : body;
  })}</>;
}

export function MessageBlocks({ blocks, className }: { blocks: Block[]; className?: string }) {
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-muted-foreground', className)}>
      {blocks.map((b, i) => b.t === 'p'
        ? <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Inlines parts={l} /></span>)}</p>
        : b.t === 'ul'
          ? <ul key={i} className="list-disc space-y-1 ps-5">{b.items.map((it, j) => <li key={j}><Inlines parts={it} /></li>)}</ul>
          : <ol key={i} className="list-decimal space-y-1 ps-5">{b.items.map((it, j) => <li key={j}><Inlines parts={it} /></li>)}</ol>)}
    </div>
  );
}

/**
 * The one in-app message card (notifications page and the admin compose preview): category icon and colour, title,
 * summary, related item chip, expandable body with "What you need to do", action button and time. Never a pop-up.
 */
export default function MessageCard({ view, lang = 'en', unread, time, onAction, actions, defaultOpen = false }: {
  view: MessageView; lang?: Lang; unread?: boolean; time?: string; onAction?: (path: string) => void; actions?: ReactNode; defaultOpen?: boolean;
}) {
  const c = MESSAGE_COPY[lang];
  const ui = CATEGORY_UI[view.category];
  const Icon = ui.icon;
  const [open, setOpen] = useState(defaultOpen);
  const d = view.decision;
  const dc = DECISION_COPY[lang];
  const long = view.blocks.length > 1 || (view.blocks[0]?.t === 'p' && view.blocks[0].lines.length > 2) || !!view.action || !!d;
  const preview = view.summary || '';
  return (
    <article dir={lang === 'ar' ? 'rtl' : 'ltr'} className="flex items-start gap-3" aria-label={view.title}>
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', ui.tile)} aria-hidden><Icon className="h-5 w-5" /></div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('rounded-full px-2 py-0 text-[11px] font-semibold', ui.chip)}>{c.categories[view.category]}</Badge>
          {d && <Badge variant="outline" className={cn('rounded-full px-2 py-0 text-[11px] font-semibold', BADGE_UI[d.badge])}>{dc.badges[d.badge]}</Badge>}
          {unread && <span className="h-2 w-2 rounded-full bg-accent" aria-label="unread" />}
          {time && <span className="ms-auto text-[11px] text-muted-foreground">{time}</span>}
        </div>
        <h3 className={cn('text-sm leading-snug text-foreground', unread ? 'font-semibold' : 'font-medium')}>{view.title}</h3>
        {preview && <p className="text-sm text-muted-foreground">{preview}</p>}
        {view.context && (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-1 text-xs text-foreground">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">{c.contextKinds[view.context.kind] ?? c.contextKinds.other}:</span>
            <span className="truncate font-medium">{view.context.label}</span>
            {view.context.ref && <span className="text-muted-foreground">{view.context.ref}</span>}
            {view.context.status && <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{view.context.status}</Badge>}
          </span>
        )}
        {(open || !long) ? (
          <>
            <MessageBlocks blocks={view.blocks} />
            {d?.comment && (
              <blockquote className="rounded-xl border-s-4 border-accent bg-accent/5 p-3 text-sm">
                <p className="text-xs font-semibold text-accent">{dc.quote}</p>
                <p className="mt-1 whitespace-pre-line text-foreground">{d.comment}</p>
              </blockquote>
            )}
            {d && d.steps.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
                <p className="text-xs font-semibold text-foreground">{dc.next}</p>
                <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-muted-foreground">{d.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            )}
            {view.action && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
                <p className="text-xs font-semibold text-warning">{c.todo}</p>
                {view.action.label && <p className="mt-0.5 text-foreground">{view.action.label}</p>}
                {view.action.deadline && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-foreground"><CalendarClock className="h-3.5 w-3.5" aria-hidden />{c.deadline}: {formatDeadline(view.action.deadline, lang)}</p>}
              </div>
            )}
          </>
        ) : !preview && <MessageBlocks blocks={view.blocks.slice(0, 1)} className="line-clamp-2" />}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onAction && <Button size="sm" onClick={(e) => { e.stopPropagation(); onAction(inAppPath(view.url)); }}>{d ? d.cta : view.action?.label ? c.open + ' · ' + view.action.label.slice(0, 40) : c.open}</Button>}
          {long && <Button size="sm" variant="ghost" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>{open ? c.showLess : c.showMore}</Button>}
          {actions}
        </div>
      </div>
    </article>
  );
}
