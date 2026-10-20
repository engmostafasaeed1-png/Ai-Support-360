import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Loader2, Send, Star, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useClientFavourites } from '@/hooks/useClientFavourites';
import { useRealtimeConsultants } from '@/hooks/useRealtimeConsultants';
import { finalInvitees, invitePreview, orderedGroups, preferredGroupFor, requestAreas, type SkipReason } from '@/lib/clientFavourites';
import { GroupBadge } from './GroupIcon';

/** Consultants already asked on a ticket (requests or private bid invitations), so a group invitation skips them. */
export function useAskedConsultants(ticketId: string | null | undefined, enabled = true): Set<string> {
  const { data } = useQuery({
    queryKey: ['ticket-asked-consultants', ticketId],
    enabled: !!ticketId && enabled,
    queryFn: async () => {
      const { data: rows } = await supabase.from('ticket_match_requests').select('consultant_id').eq('ticket_id', ticketId as string);
      return new Set((rows ?? []).map((r: { consultant_id: string }) => r.consultant_id));
    },
  });
  return data ?? new Set<string>();
}

export interface InviteCandidate { id: string; name: string; subtitle?: string }

interface Props {
  /** Consultants the client may ask on this screen (verified, not hidden). Others show as "no longer available". */
  candidates: readonly InviteCandidate[];
  alreadyAsked?: ReadonlySet<string>;
  /** SAP modules of the request: selects the preferred group for that area first. */
  modules?: readonly (string | null | undefined)[];
  /** Overrides the team-size limit (e.g. fewer places left on the request). */
  limit?: number;
  actionLabel: string;
  note?: string;
  busy?: boolean;
  onConfirm: (ids: string[]) => void | Promise<void>;
}

/**
 * "From my groups": pick a group, see who would be asked (preview), untick people, then send one normal request
 * per person through the existing flow. Never asks more people than the team-size setting (default 5).
 */
export default function GroupInvitePanel({ candidates, alreadyAsked, modules = [], limit, actionLabel, note, busy, onConfirm }: Props) {
  const { t } = useTranslation();
  const fav = useClientFavourites();
  const groups = useMemo(() => orderedGroups(fav.groups).filter((g) => !g.archived_at), [fav.groups]);
  const preferred = useMemo(() => preferredGroupFor(groups, requestAreas(modules)), [groups, modules]);
  const [groupId, setGroupId] = useState<string | null>(null);
  const activeId = groupId ?? preferred?.id ?? groups[0]?.id ?? null;
  const group = groups.find((g) => g.id === activeId) ?? null;
  const cap = Math.max(1, Math.min(limit ?? fav.inviteLimit, fav.inviteLimit));
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const preview = useMemo(
    () => invitePreview(group?.members ?? [], { selectable: new Set(byId.keys()), blocked: fav.blocked, alreadyAsked, limit: cap }),
    [group, byId, fav.blocked, alreadyAsked, cap],
  );
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // A new group (or a new preview) ticks everyone who would be asked: "invite whole group" by default.
  const previewKey = preview.ask.join(',');
  useEffect(() => { setTicked(new Set(preview.ask)); }, [previewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!fav.ready) return null;
  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        <p>{t('fav.no_groups_yet')}</p>
        <Button asChild variant="link" size="sm"><Link to="/client/my-consultants">{t('fav.open_my_consultants')}</Link></Button>
      </div>
    );
  }

  const chosen = finalInvitees(preview, ticked, cap);
  const reason = (r: SkipReason) => t(`fav.skip.${r}`);

  return (
    <div className="space-y-3" data-testid="group-invite-panel">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('fav.choose_group')}>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={g.id === activeId}
            onClick={() => setGroupId(g.id)}
            className={cn('rounded-full ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', g.id === activeId && 'ring-2 ring-primary ring-offset-1')}
          >
            <GroupBadge group={g} count={g.members.length} />
          </button>
        ))}
      </div>
      {group && preferred?.id === group.id && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground"><Star className="h-3 w-3" aria-hidden="true" />{t('fav.preferred_for_area')}</p>
      )}

      {group && (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">
            {t('fav.preview_title', { count: chosen.length, limit: cap })}
          </legend>
          {group.members.length === 0 && <p className="text-sm text-muted-foreground">{t('fav.group_empty')}</p>}
          {preview.ask.map((id) => {
            const c = byId.get(id)!;
            return (
              <label key={id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-2.5 hover:bg-muted/40">
                <Checkbox
                  checked={ticked.has(id)}
                  onCheckedChange={(v) => setTicked((prev) => { const next = new Set(prev); if (v) next.add(id); else next.delete(id); return next; })}
                  aria-label={c.name}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{c.name}</span>
                  {c.subtitle && <span className="block truncate text-xs text-muted-foreground">{c.subtitle}</span>}
                </span>
              </label>
            );
          })}
          {preview.skipped.map(({ id, reason: r }) => (
            <div key={id} className="flex items-center gap-3 rounded-lg border border-dashed border-border p-2.5 text-muted-foreground" data-testid="invite-skipped" data-reason={r}>
              <Checkbox checked={false} disabled aria-label={reason(r)} />
              <span className="min-w-0 flex-1 truncate text-sm">{r === 'unavailable' || r === 'blocked' ? t('fav.unavailable_name') : byId.get(id)?.name}</span>
              <span className="shrink-0 text-xs">{reason(r)}</span>
            </div>
          ))}
        </fieldset>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{note ?? t('fav.invite_note')}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setTicked(new Set())} disabled={chosen.length === 0 || busy}>{t('fav.untick_all')}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setTicked(new Set(preview.ask))} disabled={preview.ask.length === 0 || busy}>{t('fav.whole_group')}</Button>
        <Button type="button" size="sm" className="gap-1.5" disabled={chosen.length === 0 || busy} onClick={() => void onConfirm(chosen)}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
          {actionLabel} ({chosen.length})
        </Button>
      </div>
    </div>
  );
}

/** The group panel fed by the live consultant directory (hidden profiles already left out); mounted only while it is shown. */
export function DirectoryGroupInvite(props: Omit<ComponentProps<typeof GroupInvitePanel>, 'candidates'>) {
  const { consultants } = useRealtimeConsultants();
  const candidates = consultants.filter(c => c.verification_status === 'verified').map(c => ({ id: c.id, name: c.name, subtitle: c.specialty }));
  return <GroupInvitePanel {...props} candidates={candidates} />;
}
