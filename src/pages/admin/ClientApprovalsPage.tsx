import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, Loader2, RefreshCw, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  APPROVAL_EVENT_LABEL, APPROVAL_STATUS_LABEL, STATUS_BADGE_CLASS,
  type ClientApprovalEvent, type ClientApprovalStatus,
} from '@/lib/clientApproval';
import { cn } from '@/lib/utils';

interface Row {
  user_id: string;
  name: string;
  email: string;
  email_confirmed: boolean;
  avatar_url: string | null;
  joined_at: string;
  last_sign_in_at: string | null;
  status: ClientApprovalStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  comment: string | null;
  profile: Record<string, unknown>;
  events: ClientApprovalEvent[];
}

type Decision = 'approve' | 'request_changes' | 'reject';
type TabId = ClientApprovalStatus | 'all';

const TABS: { id: TabId; label: string }[] = [
  { id: 'awaiting_confirmation', label: 'Awaiting confirmation' },
  { id: 'changes_requested', label: 'Changes requested' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Not approved' },
  { id: 'draft', label: 'Not sent yet' },
  { id: 'all', label: 'All' },
];

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const texts = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
const num = (v: unknown): string => (typeof v === 'number' ? String(v) : '');
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : '—');

function StatusBadge({ status }: { status: ClientApprovalStatus }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap text-[11px]', STATUS_BADGE_CLASS[status])}>
      {APPROVAL_STATUS_LABEL[status]}
    </Badge>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function Field({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children || '—'}</dd>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <Badge key={i} variant="secondary" className="text-[11px] font-normal">{i}</Badge>
      ))}
    </div>
  );
}

/** The platform switch: when off, new clients are approved automatically and nobody is blocked. */
function ApprovalSwitch() {
  const qc = useQueryClient();
  const [confirmOff, setConfirmOff] = useState(false);
  const key = ['platform-setting', 'client_approval_required'];

  const { data: enabled = true, isLoading } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'client_approval_required')
        .maybeSingle();
      if (error) throw error;
      const v = data?.value;
      return !(v === false || String(v).toLowerCase() === 'false');
    },
  });

  const save = useMutation({
    mutationFn: async (next: boolean) => {
      const { data, error } = await supabase
        .from('platform_settings')
        .update({ value: next })
        .eq('key', 'client_approval_required')
        .select('key');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('The setting could not be saved');
      return next;
    },
    onSuccess: (next) => {
      qc.setQueryData(key, next);
      void qc.invalidateQueries({ queryKey: ['client-approval'] });
      toast.success(next ? 'Client approval is on' : 'Client approval is off');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="rounded-2xl border-border/50">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Label htmlFor="approval-required" className="text-sm font-semibold">Require approval for new clients</Label>
          <p className="text-xs text-muted-foreground">
            On: a client can create requests and book sessions only after an administrator approved the company information.
            Off: new clients are approved automatically and nobody is blocked.
          </p>
        </div>
        <Switch
          id="approval-required"
          checked={enabled}
          disabled={isLoading || save.isPending}
          onCheckedChange={(v) => (v ? save.mutate(true) : setConfirmOff(true))}
        />
      </CardContent>
      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off client approval?</AlertDialogTitle>
            <AlertDialogDescription>
              Clients that are waiting can create requests and book sessions at once, and new clients are approved automatically. You can turn it on again at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => save.mutate(false)}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ReviewDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const p = row.profile;
  const website = text(p.company_website);
  const contacts = Array.isArray(p.key_contacts) ? (p.key_contacts as Record<string, unknown>[]) : [];
  const hasComment = comment.trim().length >= 3;

  const decide = useMutation({
    mutationFn: async (decision: Decision) => {
      const { error } = await supabase.rpc('admin_review_client', {
        p_user_id: row.user_id,
        p_decision: decision,
        ...(comment.trim() ? { p_comment: comment.trim() } : {}),
      });
      if (error) throw error;
      return decision;
    },
    onSuccess: (decision) => {
      toast.success(
        decision === 'approve'
          ? 'Client approved. They were notified.'
          : decision === 'request_changes'
            ? 'Comments sent. The client was notified.'
            : 'Client rejected. They were notified.',
      );
      void qc.invalidateQueries({ queryKey: ['admin-client-approvals'] });
      void qc.invalidateQueries({ queryKey: ['admin-client-approval-counts'] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message || 'The decision could not be saved'),
  });
  const busy = decide.isPending;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{row.name}</DialogTitle>
            <StatusBadge status={row.status} />
            {!row.email_confirmed ? (
              <Badge variant="outline" className="border-warning/50 text-[11px] text-warning">E-mail not confirmed</Badge>
            ) : null}
          </div>
          <DialogDescription>{row.email}</DialogDescription>
        </DialogHeader>

        {row.comment && (row.status === 'changes_requested' || row.status === 'rejected') ? (
          <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Last comment{row.reviewed_by_name ? ` from ${row.reviewed_by_name}` : ''}
            </p>
            <p className="whitespace-pre-line text-foreground">{row.comment}</p>
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-5">
            <Section title="Account">
              <Field label="Joined">{when(row.joined_at)}</Field>
              <Field label="Last sign-in">{when(row.last_sign_in_at)}</Field>
              <Field label="Phone">{text(p.phone)}</Field>
              <Field label="Language">{text(p.preferred_language)}</Field>
              <Field label="Time zone">{text(p.timezone)}</Field>
              <Field label="Contact by">{text(p.communication_preference)}</Field>
              <Field label="NDA">
                {p.use_custom_nda === true
                  ? `Own NDA${text(p.custom_nda_filename) ? `: ${text(p.custom_nda_filename)}` : ''}`
                  : 'Platform NDA'}
              </Field>
            </Section>
            <Section title="Company">
              <Field label="Name">{text(p.company_name)}</Field>
              <Field label="Industry">{text(p.industry)}</Field>
              <Field label="Size">{text(p.company_size)}</Field>
              <Field label="Headquarters">{text(p.headquarters)}</Field>
              <Field label="Website">
                {/^https?:\/\//i.test(website) ? (
                  <a href={website} target="_blank" rel="noopener noreferrer" className="text-primary underline">{website}</a>
                ) : (
                  website
                )}
              </Field>
              <Field label="Description"><span className="whitespace-pre-line">{text(p.company_description)}</span></Field>
            </Section>
            <Section title="Key contacts">
              {contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">None added</p>
              ) : (
                contacts.map((c, i) => (
                  <p key={i} className="text-sm text-foreground">
                    {[text(c.name), text(c.role), text(c.email), text(c.phone)].filter(Boolean).join(' · ') || '—'}
                  </p>
                ))
              )}
            </Section>
          </div>

          <div className="space-y-5">
            <Section title="SAP">
              <Field label="Modules"><Chips items={texts(p.sap_modules)} /></Field>
              <Field label="Product">{[text(p.sap_product), text(p.sap_version)].filter(Boolean).join(' ')}</Field>
              <Field label="Hosting">{text(p.sap_hosting_type)}</Field>
              <Field label="Database">{text(p.sap_database_type)}</Field>
              <Field label="Operating system">{text(p.sap_os_type)}</Field>
              <Field label="Support pack">{text(p.sap_support_pack)}</Field>
              <Field label="Go-live">{text(p.sap_go_live_date)}</Field>
              <Field label="Users">{num(p.sap_user_count)}</Field>
              <Field label="Custom objects">{num(p.sap_custom_dev_count)}</Field>
              <Field label="System IDs"><Chips items={texts(p.sap_system_ids)} /></Field>
              <Field label="Interfaces"><Chips items={texts(p.sap_interfaces)} /></Field>
              <Field label="Third-party tools"><Chips items={texts(p.sap_third_party_tools)} /></Field>
              <Field label="Landscape"><span className="whitespace-pre-line">{text(p.sap_landscape)}</span></Field>
              <Field label="Notes"><span className="whitespace-pre-line">{text(p.sap_landscape_notes)}</span></Field>
            </Section>
            <Section title="History">
              {row.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No history yet</p>
              ) : (
                row.events.map((e, i) => (
                  <div key={`${e.created_at}-${i}`} className="rounded-lg border border-border/50 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-foreground">
                        {APPROVAL_EVENT_LABEL[e.event] ?? e.event}
                        {e.actor_name ? <span className="font-normal text-muted-foreground"> · {e.actor_name}</span> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{when(e.created_at)}</span>
                    </div>
                    {e.comment ? <p className="mt-1 whitespace-pre-line text-muted-foreground">{e.comment}</p> : null}
                  </div>
                ))
              )}
            </Section>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/30 p-4">
          <Label htmlFor="decision-comment">Comment for the client</Label>
          <Textarea
            id="decision-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Required when you send comments or reject. Say clearly what the client must add or correct."
          />
          {row.status === 'draft' ? (
            <p className="text-xs text-muted-foreground">
              This client has not sent their information yet. You can still approve the account.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy || !hasComment || row.status === 'rejected' || row.status === 'draft'}
              onClick={() => setConfirmReject(true)}
            >
              Reject
            </Button>
            <Button
              variant="outline"
              disabled={busy || !hasComment || row.status === 'draft'}
              onClick={() => decide.mutate('request_changes')}
            >
              Send comments
            </Button>
            <Button disabled={busy || row.status === 'approved'} onClick={() => decide.mutate('approve')} className="gap-2">
              {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
              Approve
            </Button>
          </div>
        </div>

        <AlertDialog open={confirmReject} onOpenChange={setConfirmReject}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject this client?</AlertDialogTitle>
              <AlertDialogDescription>
                {row.name} will be told that the account was not approved and cannot create requests or book sessions. You can send comments later to reopen it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => decide.mutate('reject')}
              >
                Reject
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

export default function ClientApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const openId = params.get('user');
  const [tab, setTab] = useState<TabId>('awaiting_confirmation');
  const [search, setSearch] = useState('');

  const { data: rows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-client-approvals'],
    queryFn: async (): Promise<Row[]> => {
      const { data, error: err } = await supabase.rpc('admin_list_client_approvals', { p_limit: 500 });
      if (err) throw err;
      return (data as unknown as Row[] | null) ?? [];
    },
    refetchInterval: 60_000,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    rows.forEach((r) => { c[r.status] = (c[r.status] ?? 0) + 1; });
    return c;
  }, [rows]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (tab === 'all' || r.status === tab) &&
          (!q ||
            r.name.toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q) ||
            text(r.profile.company_name).toLowerCase().includes(q)),
      ),
    [rows, tab, q],
  );

  const openRow = rows.find((r) => r.user_id === openId) ?? null;
  const setOpen = (id: string | null) => setParams(id ? { user: id } : {}, { replace: true });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Client approvals</h1>
          <p className="text-sm text-muted-foreground">
            Review the information a new client sent. Approve it, or send comments so the client completes it and sends it again.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw aria-hidden="true" className={cn('me-1 h-4 w-4', isFetching && 'animate-spin')} /> Refresh
        </Button>
      </div>

      <ApprovalSwitch />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TABS.slice(0, 4).map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className="text-start">
            <Card className={cn('rounded-2xl', tab === t.id ? 'border-primary' : 'border-border/50')}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className="text-2xl font-bold">{counts[t.id] ?? 0}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
              {t.label}
              <span className="rounded-full bg-muted px-1.5 text-[11px]">{counts[t.id] ?? 0}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="relative max-w-md">
        <Search aria-hidden="true" className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, e-mail or company…"
          className="ps-9"
          aria-label="Search clients"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{(error as Error).message}</p>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-border/50 p-8 text-center text-sm text-muted-foreground">
          {tab === 'awaiting_confirmation'
            ? 'Nothing is waiting for review. New clients appear here as soon as they send their company information.'
            : 'No clients in this list.'}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <button
              key={r.user_id}
              type="button"
              onClick={() => setOpen(r.user_id)}
              className="flex w-full flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4 text-start transition-colors hover:bg-muted/40 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {(r.name || r.email).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                </div>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex items-center gap-1.5 truncate text-foreground">
                  <Building2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {text(r.profile.company_name) || '—'}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[text(r.profile.industry), text(r.profile.company_size)].filter(Boolean).join(' · ') || 'No industry or size'}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 sm:justify-end">
                <span className="text-xs text-muted-foreground">
                  {r.submitted_at ? `Sent ${new Date(r.submitted_at).toLocaleDateString()}` : 'Not sent'}
                </span>
                <StatusBadge status={r.status} />
              </div>
            </button>
          ))}
        </div>
      )}

      {openRow ? <ReviewDialog key={openRow.user_id} row={openRow} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
