import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, Gift, Loader2, PlayCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { referralRpc, rpcMessage } from '@/hooks/useReferralProgram';
import { DEFAULT_MAX_RATE, FLAG_LABEL, parseRulesTexts, RULES_SECTIONS, rulesTextsProblem, type RulesTexts, formatRate, HOLD_REASON_LABEL, LINE_STATUS_LABEL, MAX_TIERS, parseTiers, rateRangeText, referralCsv, tierRangeLabel, tiersProblem, type LineStatus } from '@/lib/referrals';
import TierLadder from '@/components/referral/TierLadder';
import { cn } from '@/lib/utils';
import ReferralCalculations from '@/components/referral/ReferralCalculations';
import ReferralEmailPreview from '@/components/admin/referral/ReferralEmailPreview';
import ReferralInviteSettingsCard from '@/components/admin/referral/ReferralInviteSettingsCard';
import { useInviteSettings } from '@/hooks/useReferralInvitations';

/** In-app announcement (bell + pop-up) to every eligible consultant, once each; test to yourself first. No e-mail. */
/** Live programme numbers for the e-mail preview (tiers, months, hold, pass mark) + the example settings of the invitation. */
function EmailPreviewWithSettings({ settings }: { settings: Row }) {
  const inv = useInviteSettings();
  const rates = (Array.isArray(settings.tiers) ? (settings.tiers as Row[]) : []).map((x) => Number(x.rate)).filter((n) => Number.isFinite(n) && n > 0);
  const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : undefined);
  const mapped = useMemo(() => ({
    minRate: rates.length ? Math.min(...rates) : num(settings.rate_percent), maxRate: rates.length ? Math.max(...rates) : undefined,
    months: num(settings.months), holdDays: num(settings.hold_days), passMark: num(settings.pass_mark),
    activationDays: num(settings.activation_days), payoutChangeDays: num(settings.payout_change_hold_days),
    exampleFee: inv.data?.example_fee, currency: inv.data?.example_currency, termsDraft: inv.data ? inv.data.terms_draft : undefined,
  }), [settings, inv.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ReferralEmailPreview settings={mapped} />;
}

function AnnouncementCard() {
  const qc = useQueryClient();
  const preview = useRpc<Row>(['refadmin', 'announce-preview'], 'admin_referral_announcement_preview', { _limit: 50 });
  const log = useRpc<Row[]>(['refadmin', 'announce-log'], 'admin_referral_announcement_log', { _limit: 500 });
  const [tested, setTested] = useState(false);
  const [busy, setBusy] = useState(false);
  const counts = ((preview.data?.counts ?? {}) as Record<string, number>);
  const msg = (preview.data?.message ?? {}) as Row;
  const send = async (test: boolean) => {
    setBusy(true);
    const { data, error } = await referralRpc('admin_referral_announcement_send', { _test: test, _limit: 200 });
    setBusy(false);
    if (error) { toast.error(rpcMessage(error, 'The announcement could not be sent.')); return; }
    const r = (data ?? {}) as Row;
    if (test) { setTested(true); toast.success('Test sent to your own bell. Check it, then send to everyone.'); }
    else toast.success(`Sent to ${Number(r.sent) || 0} consultant(s). ${Number(r.remaining) || 0} left${Number(r.remaining) ? ' - press Send again for the next batch' : ''}.`);
    qc.invalidateQueries({ queryKey: ['refadmin'] });
  };
  const labels: Record<string, string> = {
    eligible: 'Will receive it', already_sent: 'Already received', rejected_or_suspended: 'Rejected / suspended profile (left out)',
    account_suspended: 'Suspended account (left out)', paused: 'Paused notifications (left out)',
  };
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Introduce Refer & earn to existing consultants</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">Sends one notification (bell and pop-up) to each consultant, once. It is not e-mailed: an announcement to every consultant is promotional bulk mail, which app e-mails must not carry. Every consultant also sees the one-time introduction pop-up on their next sign-in.</p>
        <div className="rounded-xl border border-border/60 p-3"><p className="font-medium">{String(msg.title ?? '')}</p><p className="mt-1 text-muted-foreground">{String(msg.body ?? '')}</p></div>
        <div className="flex flex-wrap gap-2">{Object.entries(counts).map(([k, v]) => <Badge key={k} variant={k === 'eligible' ? 'secondary' : 'outline'}>{labels[k] ?? k}: {v}</Badge>)}</div>
        {((preview.data?.recipients ?? []) as Row[]).length > 0 && (
          <details><summary className="cursor-pointer text-xs">First recipients ({((preview.data?.recipients ?? []) as Row[]).length} shown)</summary>
            <p className="mt-1 text-xs text-muted-foreground">{((preview.data?.recipients ?? []) as Row[]).map((r) => String(r.name ?? '-')).join(', ')}</p></details>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void send(true)} disabled={busy}>Send test to me</Button>
          <Button onClick={() => void send(false)} disabled={busy || !tested || !counts.eligible}>{busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}Send announcement ({counts.eligible ?? 0})</Button>
        </div>
        {!tested && <p className="text-xs text-muted-foreground">Send the test first; the button unlocks afterwards.</p>}
        <details><summary className="cursor-pointer text-xs">Who received it ({(log.data ?? []).length})</summary>
          <ul className="mt-2 max-h-60 overflow-y-auto text-xs space-y-0.5">{(log.data ?? []).map((r, i) => <li key={i}>{String(r.name ?? '-')} - {when(r.sent_at)}{r.sent_by_name ? ` (by ${String(r.sent_by_name)})` : ''}</li>)}</ul>
        </details>
      </CardContent>
    </Card>
  );
}

/** Existing consultants have no referrer; an administrator can set one with a reason (audited). */
function SetReferrerCard() {
  const qc = useQueryClient();
  const [referredCode, setReferredCode] = useState('');
  const [referrerCode, setReferrerCode] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const find = async (code: string) => {
    const { data } = await referralRpc('admin_referral_referrers', { _search: code.trim(), _limit: 5 });
    return ((data ?? []) as Row[]).find((r) => String(r.code).toUpperCase() === code.trim().toUpperCase());
  };
  const run = async () => {
    setBusy(true);
    const [a, b] = await Promise.all([find(referredCode), find(referrerCode)]);
    if (!a || !b) { setBusy(false); toast.error('Both referral codes must belong to a consultant.'); return; }
    const { error } = await referralRpc('admin_referral_action', { _action: 'set_referrer', _id: a.referrer_id, _reason: reason, _new_referrer: b.referrer_id });
    setBusy(false);
    if (error) { toast.error(rpcMessage(error, 'The referrer could not be set.')); return; }
    toast.success('Referrer set and recorded in the audit trail. The activation rule still applies.');
    setReferredCode(''); setReferrerCode(''); setReason('');
    qc.invalidateQueries({ queryKey: ['refadmin'] });
  };
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Set a referrer for a consultant who has none</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="space-y-1"><Label htmlFor="sr-a">Referred consultant's code</Label><Input id="sr-a" dir="ltr" className="font-mono" value={referredCode} onChange={(e) => setReferredCode(e.target.value.toUpperCase())} /></div>
        <div className="space-y-1"><Label htmlFor="sr-b">Referrer's code</Label><Input id="sr-b" dir="ltr" className="font-mono" value={referrerCode} onChange={(e) => setReferrerCode(e.target.value.toUpperCase())} /></div>
        <div className="space-y-1"><Label htmlFor="sr-r">Reason (required)</Label><Input id="sr-r" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="sm:col-span-3"><Button onClick={run} disabled={busy || reason.trim().length < 5 || !referredCode || !referrerCode}>{busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}Set referrer</Button></div>
      </CardContent>
    </Card>
  );
}

/** Same calculations page as the consultant sees, for any consultant, read-only. */
function AdminCalculations() {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string; code: string } | null>(null);
  const list = useRpc<Row[]>(['refadmin', 'pick', q], 'admin_referral_referrers', { _search: q || null, _limit: 30 });
  return (
    <div className="space-y-4">
      <Card className="rounded-2xl"><CardContent className="p-4 space-y-2">
        <Label htmlFor="calc-pick">Consultant (read-only view)</Label>
        <Input id="calc-pick" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or referral code" className="max-w-sm rounded-xl" />
        <div className="flex flex-wrap gap-2">
          {(list.data ?? []).slice(0, 12).map((r) => (
            <Button key={String(r.referrer_id)} size="sm" variant={picked?.id === String(r.referrer_id) ? 'default' : 'outline'} className="h-7 text-xs rounded-xl"
              onClick={() => setPicked({ id: String(r.referrer_id), name: String(r.referrer_name ?? '-'), code: String(r.code) })}>
              {String(r.referrer_name ?? '-')} · <span className="font-mono" dir="ltr">{String(r.code)}</span>
            </Button>
          ))}
        </div>
      </CardContent></Card>
      {picked ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">{picked.name} <Badge variant="outline" className="ms-2 text-[10px]">Read-only</Badge></p>
          <ReferralCalculations consultantId={picked.id} code={picked.code} />
        </div>
      ) : <p className="text-sm text-muted-foreground">Choose a consultant to see their referral calculations exactly as they see them.</p>}
    </div>
  );
}

/** Reconciliation: sum of lines must match rewards, reversals and referral payouts; differences are flagged. */
function ReconcileCard() {
  const [all, setAll] = useState(false);
  const rec = useRpc<Row[]>(['refadmin', 'reconcile', all], 'admin_referral_reconcile', { _consultant: null, _only_problems: !all });
  const rows = rec.data ?? [];
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2 flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Reconciliation check</CardTitle>
        <div className="flex items-center gap-2 text-xs"><Switch id="rec-all" checked={all} onCheckedChange={setAll} /><Label htmlFor="rec-all">Show passed checks too</Label></div>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        {rec.isLoading ? <div className="p-4"><Skeleton className="h-16 w-full" /></div> : rows.length === 0 ? (
          <p className="p-6 text-sm text-success">All checks pass: every reward equals fee x rate, every reversal mirrors its reward, and referral payouts equal their lines.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Consultant</TableHead><TableHead>Check</TableHead><TableHead>Result</TableHead><TableHead className="text-end">Expected</TableHead><TableHead className="text-end">Actual</TableHead><TableHead>What it means</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-sm">{String(r.consultant_name ?? '-')}</TableCell>
                <TableCell className="text-xs">{String(r.check_name).replace(/_/g, ' ')}</TableCell>
                <TableCell>{r.ok ? <Badge variant="secondary" className="text-[10px]">OK</Badge> : <Badge variant="destructive" className="text-[10px]">Different</Badge>}</TableCell>
                <TableCell className="text-end tabular-nums text-xs">{r.expected == null ? '-' : money(r.expected)}</TableCell>
                <TableCell className="text-end tabular-nums text-xs">{r.actual == null ? '-' : money(r.actual)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[280px]">{String(r.detail ?? '')}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type Row = Record<string, unknown>;
const money = (v: unknown, cur = 'USD') => {
  const n = Number(v) || 0;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(cur || 'USD') }).format(n); } catch { return `${n.toFixed(2)} ${cur}`; }
};
const when = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
const perCurrency = (o: unknown) => {
  const e = Object.entries((o ?? {}) as Record<string, unknown>);
  return e.length ? e.map(([c, v]) => money(v, c)).join(' · ') : '-';
};

/** Four-eyes adjustments: a second super administrator approves amounts above the limit. */
function AdjustRequestsCard() {
  const qc = useQueryClient();
  const list = useRpc<Row[]>(['refadmin', 'adjust-requests'], 'admin_referral_adjust_requests', { _status: 'all' });
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    const { error } = await referralRpc('admin_referral_decide_adjustment', { _request: id, _approve: approve, _note: note[id] ?? '' });
    setBusy(null);
    if (error) { toast.error(rpcMessage(error, 'The decision could not be saved.')); return; }
    toast.success(approve ? 'Approved: the adjustment line was created.' : 'Rejected. Nothing was paid.');
    qc.invalidateQueries({ queryKey: ['refadmin'] });
  };
  const rows = list.data ?? [];
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Adjustments waiting for a second approval</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        {list.isLoading ? <Skeleton className="h-16 w-full" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">No adjustment requests.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Consultant</TableHead><TableHead className="text-end">Amount</TableHead><TableHead>Reason</TableHead><TableHead>Asked by</TableHead><TableHead>State</TableHead><TableHead className="text-end">Decision</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((r) => {
              const id = String(r.id);
              return (
                <TableRow key={id}>
                  <TableCell className="text-sm">{String(r.consultant_name ?? '-')}</TableCell>
                  <TableCell className="text-end tabular-nums">{Number(r.amount).toFixed(2)} {String(r.currency)}</TableCell>
                  <TableCell className="text-xs max-w-[240px]">{String(r.reason)}</TableCell>
                  <TableCell className="text-xs">{String(r.requested_by_name ?? '-')}{r.requested_by_me ? ' (you)' : ''}<div className="text-muted-foreground">{when(r.created_at)}</div></TableCell>
                  <TableCell className="text-xs capitalize">{String(r.status)}{r.decided_by_name ? <div className="text-muted-foreground normal-case">by {String(r.decided_by_name)}</div> : null}</TableCell>
                  <TableCell className="text-end">
                    {r.can_decide ? (
                      <div className="flex flex-col items-end gap-1">
                        <Input aria-label="Reason for the decision" placeholder="Reason (required)" className="h-8 w-48 text-xs" value={note[id] ?? ''} onChange={(e) => setNote((n) => ({ ...n, [id]: e.target.value }))} />
                        <div className="space-x-1">
                          <Button size="sm" className="h-7 text-xs" disabled={busy === id || (note[id] ?? '').trim().length < 5} onClick={() => decide(id, true)}>Approve</Button>
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === id || (note[id] ?? '').trim().length < 5} onClick={() => decide(id, false)}>Reject</Button>
                        </div>
                      </div>
                    ) : r.status === 'pending' ? <span className="text-xs text-muted-foreground">Needs another super administrator</span> : null}
                  </TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** Anomaly dashboard: patterns worth a closer look (hashes never leave the database; clusters are numbered). */
function AnomaliesCard() {
  const a = useRpc<Row>(['refadmin', 'anomalies'], 'admin_referral_anomalies');
  const d = (a.data ?? {}) as Row;
  const list = (k: string) => ((d[k] ?? []) as Row[]);
  const stat = (label: string, v: unknown, warn = false) => (
    <div className="rounded-xl border border-border/60 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={cn('text-xl font-bold tabular-nums', warn && Number(v) > 0 && 'text-warning')}>{Number(v) || 0}</p></div>
  );
  const clusters = (k: string) => list(k).map((c) => (
    <li key={String(c.cluster)}>Cluster {String(c.cluster)} ({String(c.size)}): {((c.members ?? []) as Row[]).map((m) => String(m.name ?? 'Consultant')).join(', ')}</li>
  ));
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-primary" />Anomalies</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        {a.isLoading ? <Skeleton className="h-24 w-full" /> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {stat('Under review', d.under_review, true)}{stat('Held: related client', d.held_related_party, true)}{stat('Held: cap', d.held_cap, true)}
              {stat('Above the maximum rate', d.over_max_rate, true)}{stat('Reconciliation problems', d.reconcile_problems, true)}
              {stat('Fast risers (7 days)', list('fast_risers').length, true)}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div><p className="font-medium">Top earners (30 days)</p><ul className="mt-1 space-y-0.5 text-xs">{list('top_earners').map((t, i) => <li key={i}>{String(t.name ?? '-')}: {Number(t.amount).toFixed(2)} {String(t.currency)} ({String(t.lines)} lines)</li>)}{!list('top_earners').length && <li className="text-muted-foreground">None</li>}</ul></div>
              <div><p className="font-medium">Fast risers</p><ul className="mt-1 space-y-0.5 text-xs">{list('fast_risers').map((t, i) => <li key={i}>{String(t.name ?? '-')}: {String(t.new_7d)} in 7 days, {String(t.new_30d)} in 30 days, tier count {String(t.tier_count)}</li>)}{!list('fast_risers').length && <li className="text-muted-foreground">None</li>}</ul></div>
              <div><p className="font-medium">Shared network clusters</p><ul className="mt-1 space-y-0.5 text-xs">{clusters('network_clusters')}{!list('network_clusters').length && <li className="text-muted-foreground">None</li>}</ul></div>
              <div><p className="font-medium">Shared bank account clusters</p><ul className="mt-1 space-y-0.5 text-xs">{clusters('bank_clusters')}{!list('bank_clusters').length && <li className="text-muted-foreground">None</li>}</ul></div>
              <div><p className="font-medium">High reversal ratio (20 % or more)</p><ul className="mt-1 space-y-0.5 text-xs">{list('reversal_ratio').map((t, i) => <li key={i}>{String(t.name ?? '-')}: {String(t.reversals)} of {String(t.rewards)} rewards reversed</li>)}{!list('reversal_ratio').length && <li className="text-muted-foreground">None</li>}</ul></div>
              <div><p className="font-medium">Rewards against invoice totals</p><ul className="mt-1 space-y-0.5 text-xs">{list('rewards_vs_invoices').map((t, i) => <li key={i} className={cn(Number(t.percent) > Number(t.max_percent) && 'text-destructive')}>{String(t.currency)}: {Number(t.rewards ?? 0).toFixed(2)} on {Number(t.fees ?? 0).toFixed(2)} = {String(t.percent ?? 0)} % (maximum {String(t.max_percent)} %)</li>)}{!list('rewards_vs_invoices').length && <li className="text-muted-foreground">None</li>}</ul></div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** How many referrers are in each tier now (by verified, non-suspended referred consultants). */
function TierDistributionCard({ o }: { o: Row }) {
  const tiers = parseTiers((o.settings as Row | undefined)?.tiers);
  const dist = (o.tier_distribution ?? {}) as Record<string, number>;
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Tier distribution</CardTitle></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <TierLadder tiers={tiers} compact />
        <Table>
          <TableHeader><TableRow><TableHead>Tier</TableHead><TableHead>Verified referred</TableHead><TableHead className="text-end">Referrers now</TableHead></TableRow></TableHeader>
          <TableBody>{tiers.map((x, i) => (
            <TableRow key={x.min}><TableCell>{x.name}</TableCell><TableCell dir="ltr">{tierRangeLabel(tiers, i)}</TableCell><TableCell className="text-end tabular-nums">{Number(dist[x.name] ?? 0)}</TableCell></TableRow>
          ))}</TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Audit of every tier / maximum-rate change: who, when, old and new. */
function RateHistoryCard() {
  const hist = useRpc<Row[]>(['refadmin', 'rate-history'], 'admin_referral_rate_history', { _limit: 100 });
  const show = (v: unknown) => (Array.isArray(v) ? parseTiers(v).map((x) => `${x.min}+: ${formatRate(x.rate)} %`).join(' · ') : '-');
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Rate change history</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        {hist.isLoading ? <Skeleton className="h-16 w-full" /> : !(hist.data ?? []).length ? <p className="text-sm text-muted-foreground">No tier changes yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>By</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
            <TableBody>{(hist.data ?? []).map((h, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs whitespace-nowrap">{new Date(String(h.changed_at)).toLocaleString('en-GB')}</TableCell>
                <TableCell className="text-xs">{String(h.changed_by ?? '-')}</TableCell>
                <TableCell className="text-xs" dir="ltr">{show(h.old_tiers)}{h.old_max != null ? ` (max ${formatRate(Number(h.old_max))} %)` : ''}</TableCell>
                <TableCell className="text-xs" dir="ltr">{show(h.new_tiers)}{h.new_max != null ? ` (max ${formatRate(Number(h.new_max))} %)` : ''}</TableCell>
                <TableCell className="text-xs">{String(h.reason ?? '')}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function useRpc<T>(key: unknown[], fn: string, args?: Record<string, unknown>) {
  return useQuery({
    queryKey: key,
    retry: false,
    queryFn: async () => {
      const { data, error } = await referralRpc(fn, args);
      if (error) throw new Error(error.message);
      return data as T;
    },
  });
}

type ActionState = {
  action: string; id: string | null; title: string; description?: string;
  needsAmount?: boolean; needsReferrer?: boolean;
} | null;

function ActionDialog({ state, onClose }: { state: ActionState; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [newCode, setNewCode] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setAmount(''); setCurrency('USD'); setNewCode(''); }, [state]);
  if (!state) return null;
  const run = async () => {
    setBusy(true);
    let newReferrer: string | null = null;
    if (state.needsReferrer) {
      const { data, error } = await referralRpc('admin_referral_referrers', { _search: newCode.trim(), _limit: 5 });
      const hit = ((data ?? []) as Row[]).find((r) => String(r.code).toUpperCase() === newCode.trim().toUpperCase());
      if (error || !hit) { setBusy(false); toast.error('No consultant has this referral code.'); return; }
      newReferrer = String(hit.referrer_id);
    }
    const { data, error } = await referralRpc('admin_referral_action', {
      _action: state.action, _id: state.id, _reason: reason,
      _amount: state.needsAmount ? Number(amount) : null, _currency: state.needsAmount ? currency : null, _new_referrer: newReferrer,
    });
    setBusy(false);
    if (error) { toast.error(rpcMessage(error, 'The change could not be saved.')); return; }
    if (data && typeof data === 'object' && 'pending_approval' in (data as Row)) {
      toast.success('Above the four-eyes limit: a second super administrator must approve it (Security tab).');
    } else {
      toast.success('Saved and recorded in the audit trail.');
    }
    qc.invalidateQueries({ queryKey: ['refadmin'] });
    onClose();
  };
  const amountOk = !state.needsAmount || (Number(amount) !== 0 && Number.isFinite(Number(amount)) && /^[A-Za-z]{3}$/.test(currency));
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.description && <DialogDescription>{state.description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          {state.needsAmount && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2 space-y-1"><Label htmlFor="ra-amount">Amount (use minus to deduct)</Label><Input id="ra-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="ra-cur">Currency</Label><Input id="ra-cur" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
            </div>
          )}
          {state.needsReferrer && (
            <div className="space-y-1"><Label htmlFor="ra-code">Referral code of the new referrer</Label><Input id="ra-code" dir="ltr" value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} className="font-mono" /></div>
          )}
          <div className="space-y-1">
            <Label htmlFor="ra-reason">Reason (required, recorded in the audit trail)</Label>
            <Textarea id="ra-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy || reason.trim().length < 5 || !amountOk || (state.needsReferrer && !newCode.trim())}>
            {busy && <Loader2 className="w-4 h-4 me-2 animate-spin" />}Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsCard({ settings }: { settings: Row }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [claimUntil, setClaimUntil] = useState('');
  const [tiers, setTiers] = useState<Array<{ min: string; rate: string; name: string }>>([]);
  const [tierPaid, setTierPaid] = useState(true);
  const [notes, setNotes] = useState<RulesTexts>({});
  useEffect(() => {
    setTiers(parseTiers(settings.tiers, Number(settings.max_rate) || DEFAULT_MAX_RATE).map((x) => ({ min: String(x.min), rate: String(x.rate), name: x.name })));
    setClaimUntil(settings.claim_until ? String(settings.claim_until).slice(0, 16) : '');
    setEnabled(settings.enabled === true);
    setDraft({
      max_rate: String(settings.max_rate ?? DEFAULT_MAX_RATE), months: String(settings.months ?? 12), min_payout: String(settings.min_payout ?? 25),
      claim_days: String(settings.claim_days ?? 7),
      pass_mark: String(settings.pass_mark ?? 50), activation_days: String(settings.activation_days ?? 90),
      max_per_referred: settings.max_per_referred == null ? '' : String(settings.max_per_referred),
      monthly_cap: settings.monthly_cap == null ? '' : String(settings.monthly_cap),
      monthly_cap_referred: settings.monthly_cap_referred == null ? '' : String(settings.monthly_cap_referred),
      hold_days: String(settings.hold_days ?? 14), min_invoice: String(settings.min_invoice ?? 20),
      flag_threshold: String(settings.flag_threshold ?? 2), velocity_day: String(settings.velocity_day ?? 5), velocity_ip: String(settings.velocity_ip ?? 3),
      tier_paid_days: String(settings.tier_paid_days ?? 90), four_eyes_amount: String(settings.four_eyes_amount ?? 100),
      payout_change_hold_days: String(settings.payout_change_hold_days ?? 7), retention_days: String(settings.retention_days ?? 365),
    });
    setTierPaid(settings.tier_requires_paid !== false);
    setNotes(parseRulesTexts(settings.rules_texts));
  }, [settings]);
  const fields: Array<[string, string, string]> = [
    ['max_rate', 'Maximum rate for any tier (%)', '0.1 to 10, default 2'],
    ['months', 'Months from the first paid ticket', '1 to 60'],
    ['min_payout', 'Minimum available amount before a payout', 'e.g. 25'],
    ['claim_days', 'Days after sign-up a code can still be entered', '0 to 30'],
    ['pass_mark', 'AI interview pass mark for activation (both consultants)', '0 to 100, default 50'],
    ['activation_days', 'Days from sign-up to activate before the referral expires', '1 to 365, default 90'],
    ['max_per_referred', 'Maximum reward per referred consultant', 'empty = no maximum'],
    ['monthly_cap', 'Monthly cap per referrer (above it a reward is held, never cut)', 'default 1000, empty = no cap'],
    ['monthly_cap_referred', 'Monthly cap per referred consultant (held above it)', 'default 250, empty = no cap'],
    ['hold_days', 'Hold period after the payout is released (days)', '0 to 90, default 14'],
    ['min_invoice', 'Minimum invoice line for a reward (invoice currency)', 'default 20'],
    ['flag_threshold', 'Fraud signal score that puts a new referral under review', '1 to 10, default 2'],
    ['velocity_day', 'Sign-ups per referrer per day before flagging', 'default 5'],
    ['velocity_ip', 'Sign-ups per network per day before flagging', 'default 3'],
    ['tier_paid_days', 'Days after verification for the first paid ticket (tier counting)', '1 to 365, default 90'],
    ['four_eyes_amount', 'Adjustments above this need a second super administrator', 'default 100'],
    ['payout_change_hold_days', 'Days referral payouts wait after bank details change', '0 to 60, default 7'],
    ['retention_days', 'Keep hashed device / network signals (days)', '30 to 1095, default 365'],
  ];
  const save = async () => {
    const payload: Record<string, unknown> = { enabled };
    if (claimUntil) payload.claim_until = new Date(claimUntil).toISOString();
    for (const [k] of fields) {
      const v = (draft[k] ?? '').trim();
      payload[k] = (k === 'max_per_referred' || k === 'monthly_cap' || k === 'monthly_cap_referred') && v === '' ? null : Number(v);
    }
    payload.tier_requires_paid = tierPaid;
    const cleanNotes: RulesTexts = {};
    for (const [k, v] of Object.entries(notes)) {
      const e = { ...(v?.en?.trim() ? { en: v.en.trim() } : {}), ...(v?.ar?.trim() ? { ar: v.ar.trim() } : {}) };
      if (e.en || e.ar) cleanNotes[k] = e;
    }
    const notesProblem = rulesTextsProblem(cleanNotes);
    if (notesProblem) { toast.error(notesProblem); return; }
    payload.rules_texts = cleanNotes;
    const tierRows = tiers.map((x) => ({ min: x.min.trim() === '' ? '' : Number(x.min), rate: x.rate.trim() === '' ? '' : Number(x.rate), name: x.name.trim() }));
    const problem = tiersProblem(tierRows, Number(payload.max_rate) || DEFAULT_MAX_RATE);
    if (problem) { toast.error(problem); return; }
    payload.tiers = tierRows.map((x, i) => ({ min: x.min, rate: x.rate, name: x.name || `Tier ${i + 1}` }));
    setSaving(true);
    const { error } = await referralRpc('admin_referral_set_settings', { _settings: payload, _reason: reason });
    setSaving(false);
    if (error) { toast.error(rpcMessage(error, 'The settings could not be saved.')); return; }
    toast.success('Settings saved. New rewards use them from now on.');
    setReason('');
    qc.invalidateQueries({ queryKey: ['refadmin'] });
    qc.invalidateQueries({ queryKey: ['referral-public-settings'] });
  };
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 p-3">
          <div><Label htmlFor="ref-enabled">Referral programme on</Label><p className="text-xs text-muted-foreground">Off: no new attributions or rewards. Rewards already earned stay and are paid.</p></div>
          <Switch id="ref-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map(([k, label, hint]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`ref-${k}`}>{label}</Label>
              <Input id={`ref-${k}`} inputMode="decimal" value={draft[k] ?? ''} placeholder={hint} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border/60 p-3">
          <div><Label htmlFor="ref-tier-paid">Tiers count only referred consultants with a paid ticket</Label><p className="text-xs text-muted-foreground">Within the days set above after their verification (or your approval). Protects against fake accounts.</p></div>
          <Switch id="ref-tier-paid" checked={tierPaid} onCheckedChange={setTierPaid} />
        </div>
        <details className="rounded-xl border border-border/60 p-3">
          <summary className="cursor-pointer text-sm font-medium">Programme rules hub: notes per section (plain text, optional)</summary>
          <p className="mt-1 text-xs text-muted-foreground">Shown at the top of each section on the consultant's Refer &amp; earn page and in the rules PDF. Plain text only (no &lt; or &gt;), up to 600 characters. All numbers already come from the settings above.</p>
          <div className="mt-2 space-y-3">
            {RULES_SECTIONS.map((sec) => (
              <div key={sec} className="grid gap-2 sm:grid-cols-2">
                {(['en', 'ar'] as const).map((l) => (
                  <div key={l} className="space-y-1">
                    <Label htmlFor={`note-${sec}-${l}`} className="text-xs capitalize">{sec} ({l === 'en' ? 'English' : 'Arabic'})</Label>
                    <Textarea id={`note-${sec}-${l}`} dir={l === 'ar' ? 'rtl' : 'ltr'} rows={2} maxLength={600} value={notes[sec]?.[l] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [sec]: { ...n[sec], [l]: e.target.value } }))} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
        <fieldset className="space-y-2 rounded-xl border border-border/60 p-3">
          <legend className="px-1 text-sm font-medium">Reward tiers (by verified, non-suspended referred consultants)</legend>
          <p className="text-xs text-muted-foreground">Up to {MAX_TIERS} tiers. The first starts at 0; counts and rates must go up. A change applies to rewards created from now on; existing rewards keep their rate.</p>
          {tiers.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
              <div className="space-y-1"><Label htmlFor={`tier-name-${i}`} className="text-xs">Name</Label><Input id={`tier-name-${i}`} value={x.name} maxLength={30} onChange={(e) => setTiers((t) => t.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} /></div>
              <div className="space-y-1"><Label htmlFor={`tier-min-${i}`} className="text-xs">From (verified)</Label><Input id={`tier-min-${i}`} inputMode="numeric" value={x.min} disabled={i === 0} onChange={(e) => setTiers((t) => t.map((r, j) => (j === i ? { ...r, min: e.target.value } : r)))} /></div>
              <div className="space-y-1"><Label htmlFor={`tier-rate-${i}`} className="text-xs">Rate %</Label><Input id={`tier-rate-${i}`} inputMode="decimal" value={x.rate} onChange={(e) => setTiers((t) => t.map((r, j) => (j === i ? { ...r, rate: e.target.value } : r)))} /></div>
              <Button type="button" variant="ghost" size="sm" disabled={tiers.length <= 1} onClick={() => setTiers((t) => t.filter((_, j) => j !== i))} aria-label={`Remove ${x.name || `tier ${i + 1}`}`}>Remove</Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={tiers.length >= MAX_TIERS} onClick={() => setTiers((t) => [...t, { min: '', rate: '', name: `Tier ${t.length + 1}` }])}>Add tier</Button>
        </fieldset>
        <div className="space-y-1">
          <Label htmlFor="ref-claim-until">Existing consultants may enter "Who invited you?" until</Label>
          <Input id="ref-claim-until" type="datetime-local" value={claimUntil} onChange={(e) => setClaimUntil(e.target.value)} className="max-w-xs" />
          <p className="text-xs text-muted-foreground">Default: 14 days after the launch ({settings.launch_at ? new Date(String(settings.launch_at)).toLocaleDateString('en-GB') : 'not launched yet'}). After it, only an administrator can set a referrer.</p>
        </div>
        <div className="space-y-1"><Label htmlFor="ref-reason">Reason for the change (required)</Label><Input id="ref-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
        <Button onClick={save} disabled={saving || reason.trim().length < 5}>{saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}Save settings</Button>
      </CardContent>
    </Card>
  );
}

async function exportCsv(kind: 'lines' | 'referrals') {
  const { data, error } = await referralRpc('admin_referral_export', { _kind: kind });
  if (error) { toast.error(rpcMessage(error, 'The export failed.')); return; }
  const rows = (data ?? []) as Row[];
  const cols: Array<[string, string]> = kind === 'lines'
    ? [['created_at', 'Date'], ['kind', 'Type'], ['status', 'Status'], ['referrer_name', 'Referrer'], ['referred_name', 'Referred consultant'],
       ['fee_amount', 'Referred fee'], ['rate_percent', 'Rate %'], ['tier_name', 'Tier'], ['tier_count', 'Verified at the time'], ['amount', 'Reward'], ['currency', 'Currency'], ['referral_payout_id', 'Referral payout'], ['note', 'Note'], ['id', 'Line id']]
    : [['attributed_at', 'Signed up'], ['referred_name', 'Referred consultant'], ['referrer_name', 'Referrer'], ['code', 'Code'], ['source', 'Source'], ['status', 'Status'],
       ['flags', 'Flags'], ['activation_status', 'Activation'], ['activated_at', 'Active since'], ['referrer_passed', 'Referrer passed'], ['referred_passed', 'Referred passed'], ['referrer_acknowledged', 'Referrer acknowledged'], ['referred_acknowledged', 'Referred acknowledged'], ['first_paid_at', 'First paid ticket'], ['window_ends_at', 'Rewards until'], ['earned', 'Earned']];
  const blob = new Blob(['\ufeff' + referralCsv(rows, cols)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `referral-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast.success(`Exported ${rows.length} rows (recorded in the audit trail).`);
}

export default function ReferralsAdminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [lineStatus, setLineStatus] = useState('all');
  const [action, setAction] = useState<ActionState>(null);
  const overview = useRpc<Row>(['refadmin', 'overview'], 'admin_referral_overview');
  const referrals = useRpc<Row[]>(['refadmin', 'referrals', search, filter], 'admin_referral_referrals', { _search: search || null, _filter: filter, _limit: 300, _offset: 0 });
  const referrers = useRpc<Row[]>(['refadmin', 'referrers', search], 'admin_referral_referrers', { _search: search || null, _limit: 300 });
  const lines = useRpc<Row[]>(['refadmin', 'lines', lineStatus], 'admin_referral_lines', { _status: lineStatus === 'all' ? null : lineStatus, _limit: 500, _offset: 0 });
  const events = useRpc<Row[]>(['refadmin', 'events'], 'admin_referral_events', { _limit: 200 });

  const missing = overview.error && /does not exist|schema cache|PGRST202/i.test(String((overview.error as Error).message));
  const o = overview.data ?? {};
  const money0 = useMemo(() => ((o.money ?? []) as Row[]), [o.money]);

  if (missing) {
    return (
      <Card className="rounded-2xl"><CardContent className="p-6 text-sm space-y-2">
        <p className="font-medium flex items-center gap-2"><Gift className="w-4 h-4 text-primary" />Referral programme not switched on yet</p>
        <p className="text-muted-foreground">This page works once the prepared database file docs/sql/referral-program.sql has been applied.</p>
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Gift className="w-6 h-6 text-primary" />{t('refz.admin_title', 'Referrals')}</h1>
          <p className="text-sm text-muted-foreground">Consultant referral programme: {rateRangeText(parseTiers((o.settings as Row | undefined)?.tiers))} % (by tier) of the referred consultant's fee for {String((o.settings as Row | undefined)?.months ?? 12)} months, paid by the platform.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['refadmin'] })}><RefreshCw className="w-4 h-4 me-1" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={() => setAction({ action: 'run_payouts', id: null, title: 'Create referral payouts now', description: 'Groups available rewards that reached the minimum into normal payouts (Payments, Payouts). This also runs every night.' })}>
            <PlayCircle className="w-4 h-4 me-1" />Run payout grouping
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCsv('lines')}><Download className="w-4 h-4 me-1" />Rewards CSV</Button>
          <Button variant="outline" size="sm" onClick={() => exportCsv('referrals')}><Download className="w-4 h-4 me-1" />Referrals CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {([['Referrers', o.referrers], ['Referred', o.referred], ['Pending activation', o.pending_activation], ['Active', o.active_pairs], ['Expired', o.expired], ['Verified', o.verified], ['Paying', o.paying], ['Waiting for review', o.review]] as Array<[string, unknown]>).map(([label, v]) => (
          <Card key={label} className="rounded-2xl"><CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{label}</p>
            {overview.isLoading ? <Skeleton className="mt-1 h-7 w-12" /> : <p className={cn('mt-1 text-2xl font-bold tabular-nums', label === 'Waiting for review' && Number(v) > 0 && 'text-warning')}>{Number(v) || 0}</p>}
          </CardContent></Card>
        ))}
      </div>
      {money0.length > 0 && (
        <Card className="rounded-2xl"><CardContent className="p-4 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Currency</TableHead><TableHead className="text-end">Pending</TableHead><TableHead className="text-end">Available</TableHead><TableHead className="text-end">On hold</TableHead><TableHead className="text-end">In a payout</TableHead><TableHead className="text-end">Paid</TableHead><TableHead className="text-end">Platform cost this month</TableHead></TableRow></TableHeader>
            <TableBody>{money0.map((m) => (
              <TableRow key={String(m.currency)}>
                <TableCell>{String(m.currency)}</TableCell>
                {(['pending', 'available', 'held', 'in_payout', 'paid', 'this_month'] as const).map((k) => <TableCell key={k} className="text-end tabular-nums">{money(m[k], String(m.currency))}</TableCell>)}
              </TableRow>
            ))}</TableBody>
          </Table>
        </CardContent></Card>
      )}

      <Tabs defaultValue="referred">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="referred">By referred consultant</TabsTrigger>
          <TabsTrigger value="referrers">By referrer</TabsTrigger>
          <TabsTrigger value="lines">Reward lines</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
          <TabsTrigger value="calc">Calculations</TabsTrigger>
          <TabsTrigger value="announce">Announcement</TabsTrigger>
          <TabsTrigger value="emails">E-mails & invitation</TabsTrigger>
          <TabsTrigger value="reconcile">Reconciliation</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <div className="mt-3 flex flex-wrap gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code" className="max-w-xs rounded-xl" aria-label="Search name or code" />
        </div>

        <TabsContent value="referred">
          <div className="mb-2 flex flex-wrap gap-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-56 rounded-xl" aria-label="Filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All referrals</SelectItem>
                <SelectItem value="pending_activation">Pending activation</SelectItem>
                <SelectItem value="active_pairs">Active</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="flagged">Fraud signals / review</SelectItem>
                <SelectItem value="held">Held or in review</SelectItem>
                <SelectItem value="paying">With a paid ticket</SelectItem>
                <SelectItem value="removed">Removed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card className="rounded-2xl"><CardContent className="p-0 overflow-x-auto">
            {referrals.isLoading ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> : (referrals.data ?? []).length === 0 ? <p className="p-6 text-sm text-muted-foreground">No referrals yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Referred consultant</TableHead><TableHead>Referrer</TableHead><TableHead>Activation</TableHead><TableHead>Status</TableHead><TableHead>Signals</TableHead><TableHead>Dates</TableHead><TableHead className="text-end">Earned</TableHead><TableHead className="text-end">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{(referrals.data ?? []).map((r) => {
                  const signals = [...((r.flags as string[]) ?? []), ...((r.signals as string[]) ?? [])];
                  const id = String(r.referred_id);
                  return (
                    <TableRow key={id}>
                      <TableCell className="text-sm"><div className="font-medium">{String(r.referred_name ?? '-')}</div><div className="text-xs text-muted-foreground">Visible to clients as: {String(r.referred_public ?? '-')}</div>{r.verified ? <Badge variant="outline" className="mt-1 text-[10px]">Verified</Badge> : null}</TableCell>
                      <TableCell className="text-sm"><div>{String(r.referrer_name ?? '-')}</div><div className="font-mono text-xs text-muted-foreground" dir="ltr">{String(r.code)}</div><div className="text-xs text-muted-foreground">{String(r.source)}</div></TableCell>
                      <TableCell className="text-xs min-w-[200px]">
                        <Badge variant={r.activation_status === 'active' ? 'secondary' : r.activation_status === 'expired' ? 'destructive' : 'outline'} className="text-[10px] capitalize">{String(r.activation_status)}</Badge>
                        <div className="mt-1">Referrer: {r.referrer_passed ? 'passed' : `not passed${r.referrer_best_score != null ? ` (best ${Math.round(Number(r.referrer_best_score))})` : ''}`} · {r.referrer_acknowledged ? 'acknowledged' : 'not acknowledged'}</div>
                        <div>Referred: {r.referred_passed ? 'passed' : `not passed${r.referred_best_score != null ? ` (best ${Math.round(Number(r.referred_best_score))})` : ''}`} · {r.referred_acknowledged ? 'acknowledged' : 'not acknowledged'}</div>
                        <div className="text-muted-foreground">{r.activation_status === 'active' ? `Active since ${when(r.activated_at)}` : `Deadline ${when(r.activation_expires_at)}`}</div>
                      </TableCell>
                      <TableCell><Badge variant={r.status === 'active' ? 'secondary' : r.status === 'removed' ? 'outline' : 'destructive'} className="text-[10px] capitalize">{String(r.status)}</Badge></TableCell>
                      <TableCell className="text-xs max-w-[220px]">{signals.length ? signals.map((s) => <div key={s} className="flex items-center gap-1 text-warning"><ShieldAlert className="w-3 h-3" />{FLAG_LABEL[s] ?? s}</div>) : '-'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap"><div>Signed up {when(r.attributed_at)}</div><div>First paid {when(r.first_paid_at)}</div><div>Until {when(r.window_ends_at)}</div></TableCell>
                      <TableCell className="text-end text-sm tabular-nums">{perCurrency(r.earned)}</TableCell>
                      <TableCell className="text-end whitespace-nowrap space-x-1">
                        {r.activation_status === 'pending' && r.status !== 'removed' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction({ action: 'resend', id, title: 'Resend reminders', description: 'Sends the acknowledgement request or the AI interview reminder to whichever side is missing it (once per 24 hours).' })}>Resend</Button>}
                        {r.activation_status === 'expired' && r.status !== 'removed' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction({ action: 'revive', id, title: 'Revive this referral', description: 'It becomes pending again with a new activation period. Both still have to pass the AI interview and accept the terms.' })}>Revive</Button>}
                        {r.status !== 'active' && r.status !== 'removed' && <Button size="sm" className="h-7 text-xs" onClick={() => setAction({ action: 'approve_referral', id, title: 'Approve this referral', description: 'Held rewards for it are released.' })}>Approve</Button>}
                        {r.status === 'active' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction({ action: 'hold_referral', id, title: 'Hold this referral', description: 'Pending and available rewards are held; new rewards are held too.' })}>Hold</Button>}
                        {r.status !== 'removed' && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction({ action: 'change_referrer', id, title: 'Change the referrer', description: 'New rewards go to the new referrer. Existing lines stay as they are.', needsReferrer: true })}>Change referrer</Button>}
                        {r.status !== 'removed' && <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setAction({ action: 'remove_referral', id, title: 'Remove this referral', description: 'No new rewards. Existing lines are not reversed automatically.' })}>Remove</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="referrers">
          <Card className="rounded-2xl"><CardContent className="p-0 overflow-x-auto">
            {referrers.isLoading ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> : (referrers.data ?? []).length === 0 ? <p className="p-6 text-sm text-muted-foreground">No referrers yet. Search a name or code to find any consultant's code.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Referrer</TableHead><TableHead>Code</TableHead><TableHead className="text-end">Referred / verified / paying</TableHead><TableHead>Rewards</TableHead><TableHead className="text-end">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{(referrers.data ?? []).map((r) => {
                  const id = String(r.referrer_id);
                  return (
                    <TableRow key={id}>
                      <TableCell className="text-sm font-medium">{String(r.referrer_name ?? '-')}</TableCell>
                      <TableCell><span className="font-mono text-xs" dir="ltr">{String(r.code)}</span>{r.disabled ? <Badge variant="destructive" className="ms-2 text-[10px]">Switched off</Badge> : null}</TableCell>
                      <TableCell className="text-end tabular-nums text-sm">{Number(r.referred)} / {Number(r.verified)} / {Number(r.paying)}</TableCell>
                      <TableCell className="text-xs">{Object.entries((r.money ?? {}) as Record<string, Row>).map(([c, m]) => <div key={c}>{c}: pending {money(m.pending, c)}, available {money(m.available, c)}, paid {money(m.paid, c)}</div>)}</TableCell>
                      <TableCell className="text-end whitespace-nowrap space-x-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction({ action: 'adjust', id, title: 'Adjust rewards', description: 'Adds an available line (positive or negative) to this referrer.', needsAmount: true })}>Adjust</Button>
                        {r.disabled
                          ? <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction({ action: 'enable_code', id, title: 'Switch the code on again' })}>Enable code</Button>
                          : <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setAction({ action: 'disable_code', id, title: 'Switch this code off', description: 'New sign-ups can no longer use it. Existing referrals stay.' })}>Disable code</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="lines">
          <div className="mb-2">
            <Select value={lineStatus} onValueChange={setLineStatus}>
              <SelectTrigger className="w-48 rounded-xl" aria-label="Status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {(Object.keys(LINE_STATUS_LABEL) as LineStatus[]).map((s) => <SelectItem key={s} value={s}>{LINE_STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card className="rounded-2xl"><CardContent className="p-0 overflow-x-auto">
            {lines.isLoading ? <div className="p-4"><Skeleton className="h-20 w-full" /></div> : (lines.data ?? []).length === 0 ? <p className="p-6 text-sm text-muted-foreground">No reward lines.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Referrer / referred</TableHead><TableHead className="text-end">Fee x rate</TableHead><TableHead className="text-end">Amount</TableHead><TableHead>Status</TableHead><TableHead className="text-end">Actions</TableHead></TableRow></TableHeader>
                <TableBody>{(lines.data ?? []).map((l) => {
                  const id = String(l.id);
                  return (
                    <TableRow key={id}>
                      <TableCell className="text-xs">{when(l.created_at)}</TableCell>
                      <TableCell className="text-xs capitalize">{String(l.kind)}{l.note ? <div className="text-muted-foreground normal-case">{String(l.note)}</div> : null}</TableCell>
                      <TableCell className="text-xs"><div>{String(l.referrer_name ?? '-')}</div><div className="text-muted-foreground">{String(l.referred_name ?? '-')}</div></TableCell>
                      <TableCell className="text-end text-xs tabular-nums">{l.fee_amount != null ? `${money(l.fee_amount, String(l.currency))} x ${formatRate(Number(l.rate_percent) || 0)} %` : '-'}{l.tier_name ? <div className="text-[10px] text-muted-foreground">{String(l.tier_name)}{l.tier_count != null ? ` (${String(l.tier_count)} verified)` : ''}</div> : null}</TableCell>
                      <TableCell className={cn('text-end text-sm font-semibold tabular-nums', Number(l.amount) < 0 && 'text-destructive')}>{money(l.amount, String(l.currency))}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{LINE_STATUS_LABEL[l.status as LineStatus] ?? String(l.status)}</Badge>{l.hold_reason ? <div className="text-[10px] text-muted-foreground">{HOLD_REASON_LABEL[String(l.hold_reason)] ?? String(l.hold_reason)}</div> : null}{Array.isArray(l.flags) && (l.flags as string[]).length > 0 ? <div className="text-[10px] text-warning">{(l.flags as string[]).map((f) => FLAG_LABEL[f] ?? f).join(', ')}</div> : null}{l.status === 'pending' && l.matures_at ? <div className="text-[10px] text-muted-foreground">Available from {when(l.matures_at)}</div> : null}</TableCell>
                      <TableCell className="text-end whitespace-nowrap space-x-1">
                        {l.status === 'held' && <Button size="sm" className="h-7 text-xs" onClick={() => setAction({ action: 'approve_line', id, title: 'Release this reward' })}>Approve</Button>}
                        {(l.status === 'pending' || l.status === 'available') && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAction({ action: 'hold_line', id, title: 'Hold this reward' })}>Hold</Button>}
                        {l.kind === 'reward' && l.status !== 'reversed' && <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setAction({ action: 'reverse_line', id, title: 'Reverse this reward', description: 'Not yet paid: cancelled. Already paid: deducted from the next referral payout.' })}>Reverse</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">{overview.data ? <SettingsCard settings={(o.settings ?? {}) as Row} /> : <Skeleton className="h-40 w-full rounded-2xl" />}<TierDistributionCard o={o} /><RateHistoryCard /></TabsContent>

        <TabsContent value="calc"><AdminCalculations /></TabsContent>
        <TabsContent value="announce" className="space-y-4"><AnnouncementCard /><SetReferrerCard /></TabsContent>
        <TabsContent value="emails" className="space-y-4"><ReferralInviteSettingsCard /><EmailPreviewWithSettings settings={(o.settings ?? {}) as Row} /></TabsContent>
        <TabsContent value="reconcile"><ReconcileCard /></TabsContent>
        <TabsContent value="security" className="space-y-4"><AdjustRequestsCard /><AnomaliesCard /></TabsContent>

        <TabsContent value="audit">
          <Card className="rounded-2xl"><CardContent className="p-0 overflow-x-auto">
            {(events.data ?? []).length === 0 ? <p className="p-6 text-sm text-muted-foreground">Nothing recorded yet.</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>When</TableHead><TableHead>What</TableHead><TableHead>By</TableHead><TableHead>Referrer / referred</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
                <TableBody>{(events.data ?? []).map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs whitespace-nowrap">{e.created_at ? new Date(String(e.created_at)).toLocaleString('en-GB') : '-'}</TableCell>
                    <TableCell className="text-xs">{String(e.action).replace(/_/g, ' ')}</TableCell>
                    <TableCell className="text-xs">{String(e.actor_name ?? 'System')}</TableCell>
                    <TableCell className="text-xs"><div>{String(e.referrer_name ?? '-')}</div><div className="text-muted-foreground">{String(e.referred_name ?? '')}</div></TableCell>
                    <TableCell className="text-xs max-w-[260px]">{String(e.reason ?? '-')}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <ActionDialog state={action} onClose={() => setAction(null)} />
    </div>
  );
}
