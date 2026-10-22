import { useTranslation } from 'react-i18next';
import ClientViewHint from '@/components/admin/ClientViewHint';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { UserRow } from '@/lib/userAdmin';
import type { InviteStatus } from '@/lib/referralInvitations';
import { columnLabel, type Column } from './UsersToolbar';
import { STATUS_VARIANT, fmtDate, roleLabel, statusLabel, verificationLabel } from './labels';

const SORTABLE: Partial<Record<Column, string>> = { created_at: 'created_at', last_active_at: 'last_active_at', completion: 'completion', open_tickets: 'open_tickets', status: 'status' };

export default function UsersList({ rows, loading, columns, selected, focus, sort, dir, onSort, onToggle, onTogglePage, onOpen, onFocus, invited }: {
  rows: UserRow[]; loading: boolean; columns: Column[]; selected: Set<string>; focus: number; sort: string; dir: 'asc' | 'desc';
  onSort: (key: string) => void; onToggle: (id: string) => void; onTogglePage: (on: boolean) => void; onOpen: (u: UserRow) => void; onFocus: (i: number) => void;
  /** Refer & earn invitation per user (latest), shown as "Invited on <date> (v1)". No opened/clicked: nothing is tracked. */
  invited?: Map<string, InviteStatus>;
}) {
  const { t } = useTranslation();
  const invitedBadge = (u: UserRow) => {
    const s = invited?.get(u.id);
    if (!s) return null;
    return <span className="mt-0.5 inline-block rounded-full bg-refer-from/10 px-1.5 text-[10px] text-foreground">{t('rinv.invited_on', 'Invited on {{date}} (v{{v}})', { date: fmtDate(s.invited_at), v: s.version })}{s.channels?.length ? ` · ${s.channels.map((c) => t(`chan.c_${c}`, c)).join(', ')}` : ''}</span>;
  };
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someOn = rows.some((r) => selected.has(r.id));

  if (loading) return <div className="space-y-2 p-4 md:min-h-[70vh]" aria-busy="true" aria-label={t('um.loading', 'Loading people')}>{[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>;

  const cell = (u: UserRow, c: Column) => {
    switch (c) {
      case 'roles': return u.roles.length ? <div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} variant="outline" className="text-[10px]">{roleLabel(t, r)}</Badge>)}</div> : <span className="text-xs text-muted-foreground">{t('um.role_none', 'No role')}</span>;
      case 'status': return (
        <div className="flex flex-col items-start gap-1">
          <Badge variant={STATUS_VARIANT[u.status]} className="text-[10px]">{statusLabel(t, u.status)}</Badge>
          {u.client_approval && u.client_approval !== 'approved' && u.roles.includes('client') && <Badge variant="outline" className="text-[10px]">{t('um.client_short', 'Client')}: {u.client_approval.replace(/_/g, ' ')}</Badge>}
        </div>
      );
      case 'company': return u.company || (u.organisations?.[0] ?? '—');
      case 'country': return u.country || '—';
      case 'verification': return u.verification_status ? verificationLabel(t, u.verification_status) : '—';
      case 'completion': return u.completion != null ? `${u.completion}%` : '—';
      case 'open_tickets': return u.open_tickets ?? '—';
      case 'providers': return u.providers.map((p) => (p === 'google' ? 'Google' : t('um.email_password', 'E-mail'))).join(', ') || '—';
      case 'tags': return u.tags.length ? u.tags.map((x) => `#${x}`).join(' ') : '—';
      case 'created_at': return fmtDate(u.created_at);
      case 'last_active_at': return fmtDate(u.last_active_at);
    }
  };

  const person = (u: UserRow) => (
    <button type="button" className="flex min-w-0 items-center gap-3 text-start" onClick={() => onOpen(u)}>
      {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
        : <span className="gradient-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-primary-foreground" aria-hidden>{(u.name || u.email).slice(0, 2).toUpperCase()}</span>}
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{u.name || '—'}{u.is_self && <span className="text-xs text-muted-foreground"> · {t('um.you', 'you')}</span>}</span>
        {u.consultant_id && <ClientViewHint id={u.consultant_id} className="truncate" />}
        <span className="block truncate text-xs text-muted-foreground" dir="ltr">{u.email}</span>
        {invitedBadge(u)}
      </span>
    </button>
  );

  return (
    <>
      {/* Desktop table */}
      <div className="table-scroll sticky-head hidden max-h-[70vh] overflow-auto md:block">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">{t('um.people', 'People')}</caption>
          <thead>
            <tr className="border-b border-border/50 bg-muted/30">
              <th scope="col" className="w-10 px-3 py-3"><Checkbox checked={allOn ? true : someOn ? 'indeterminate' : false} onCheckedChange={(v) => onTogglePage(!!v)} aria-label={t('um.select_page', 'Select all on this page')} /></th>
              <th scope="col" className="px-3 py-3 text-start font-medium text-muted-foreground" aria-sort={sort === 'name' ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort('name')}>{t('um.person', 'Person')}{sort === 'name' && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button>
              </th>
              {columns.map((c) => {
                const key = SORTABLE[c];
                return (
                  <th key={c} scope="col" className="px-3 py-3 text-start font-medium text-muted-foreground" aria-sort={key && sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {key ? <button type="button" className="inline-flex items-center gap-1" onClick={() => onSort(key)}>{columnLabel(t, c)}{sort === key && (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button> : columnLabel(t, c)}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((u, i) => (
              <tr key={u.id} data-row={i} tabIndex={-1} onFocus={() => onFocus(i)} aria-selected={selected.has(u.id)}
                className={cn('outline-none hover:bg-muted/20 focus-visible:bg-primary/5', focus === i && 'bg-primary/5 ring-1 ring-inset ring-primary/40')}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpen(u); if (e.key === 'x') onToggle(u.id); }}>
                <td className="px-3 py-3"><Checkbox checked={selected.has(u.id)} onCheckedChange={() => onToggle(u.id)} aria-label={t('um.select_person', 'Select {{name}}', { name: u.name || u.email })} /></td>
                <td className="max-w-64 px-3 py-3">{person(u)}</td>
                {columns.map((c) => <td key={c} className="px-3 py-3 text-muted-foreground">{cell(u, c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phone cards */}
      <ul className="divide-y divide-border/50 md:hidden" aria-label={t('um.people', 'People')}>
        {rows.map((u, i) => (
          <li key={u.id} data-row={i} tabIndex={-1} className={cn('flex gap-3 p-3', focus === i && 'bg-primary/5')}>
            <Checkbox className="mt-2" checked={selected.has(u.id)} onCheckedChange={() => onToggle(u.id)} aria-label={t('um.select_person', 'Select {{name}}', { name: u.name || u.email })} />
            <div className="min-w-0 flex-1 space-y-1.5">
              {person(u)}
              <div className="flex flex-wrap gap-1">
                <Badge variant={STATUS_VARIANT[u.status]} className="text-[10px]">{statusLabel(t, u.status)}</Badge>
                {u.roles.map((r) => <Badge key={r} variant="outline" className="text-[10px]">{roleLabel(t, r)}</Badge>)}
              </div>
              <p className="text-xs text-muted-foreground">{t('um.joined', 'Joined')} {fmtDate(u.created_at)} · {t('um.last_active', 'Last active')} {fmtDate(u.last_active_at)}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
