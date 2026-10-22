import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReferralCalculations from '@/components/referral/ReferralCalculations';
import { openReferralIntro } from '@/components/referral/ReferEarnStepHost';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Award, Check, Copy, Gift, Info, Link2, Loader2, Mail, MessageCircle, Pencil, QrCode, Send, Share2, ShieldAlert, Users, Wallet,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import QRCodeDisplay from '@/components/referral/QRCodeDisplay';
import ReferralsPage from '@/pages/ReferralsPage';
import { useGuestMode } from '@/contexts/GuestModeContext';
import {
  referralRpc, rpcMessage, useInvalidateReferral, useMyReferralHistory, useMyReferralInvite, useMyReferralList, useReferralOverview,
  type EarningsRow, type ReferralOverview,
} from '@/hooks/useReferralProgram';
import {
  formatRate, LINE_STATUS_LABEL, normalizeReferralCode, REFERRAL_STATUS_LABEL, referralCodeProblem, referralLink, referrerBadges,
  rewardPerManDay, shareMessage, shareUrl, type LineStatus, type ReferralStatus, type ShareChannel,
} from '@/lib/referrals';
import { cn } from '@/lib/utils';
import { ChipBadge, InviteCard, ReferrerActivationCard, useNextStepText } from '@/components/referral/ReferralActivation';

const STATUS_TONE: Record<string, string> = {
  signed_up: 'bg-muted text-muted-foreground',
  verified: 'bg-primary/10 text-primary',
  paying: 'bg-success/15 text-success',
  ended: 'bg-muted text-muted-foreground',
  on_review: 'bg-warning/15 text-warning',
  pending: 'bg-muted text-muted-foreground',
  available: 'bg-success/15 text-success',
  held: 'bg-warning/15 text-warning',
  in_payout: 'bg-primary/10 text-primary',
  paid: 'bg-success/15 text-success',
  reversed: 'bg-destructive/10 text-destructive',
};

function useFormat() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  return useMemo(() => {
    const locale = lang === 'ar' ? 'ar-EG' : 'en-US';
    return {
      lang: lang as 'en' | 'ar',
      money: (v: number, cur = 'USD') => {
        try { return new Intl.NumberFormat(locale, { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(v); }
        catch { return `${v.toFixed(2)} ${cur}`; }
      },
      date: (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)) : '-'),
      num: (v: number) => new Intl.NumberFormat(locale).format(v),
    };
  }, [lang]);
}

function CodeCard({ ov, locked }: { ov: ReferralOverview; locked: boolean }) {
  const { t } = useTranslation();
  const f = useFormat();
  const invalidate = useInvalidateReferral();
  const [copied, setCopied] = useState<'code' | 'link' | 'text' | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ov.code);
  const [saving, setSaving] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [msgLang, setMsgLang] = useState<'en' | 'ar'>(f.lang);
  const link = referralLink(ov.code);
  const msg = shareMessage(msgLang, { code: ov.code, link, rate: ov.settings.rate_percent, months: ov.settings.months });
  const problem = referralCodeProblem(draft);

  const copy = async (what: 'code' | 'link' | 'text', value: string) => {
    try { await navigator.clipboard.writeText(value); } catch { toast.error(t('refz.copy_failed', 'Copy did not work. Select the text and copy it yourself.')); return; }
    setCopied(what);
    toast.success(t('refz.copied', 'Copied'));
    setTimeout(() => setCopied(null), 1800);
  };
  const save = async () => {
    if (problem) return;
    setSaving(true);
    const { error } = await referralRpc('referral_update_code', { _code: normalizeReferralCode(draft) });
    setSaving(false);
    if (error) { toast.error(rpcMessage(error, t('refz.code_failed', 'The code could not be changed.'))); return; }
    toast.success(t('refz.code_saved', 'Your new code is saved. Links with your old code keep working.'));
    setEditing(false);
    invalidate();
  };
  const open = (c: ShareChannel) => window.open(shareUrl(c, link, msg.text, msg.subject), c === 'email' ? '_self' : '_blank', 'noopener');

  const channels: Array<[ShareChannel, string, typeof Send]> = [
    ['whatsapp', 'WhatsApp', MessageCircle], ['linkedin', 'LinkedIn', Share2], ['telegram', 'Telegram', Send], ['x', 'X', Share2],
    ['email', t('refz.email', 'E-mail'), Mail],
  ];

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" />{t('refz.your_code', 'Your code and link')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {ov.disabled && (
          <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{t('refz.code_disabled', 'Your referral code is switched off. Please contact support.')}</p>
        )}
        {!editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="rounded-xl border border-border bg-muted/40 px-4 py-2 font-mono text-lg font-semibold tracking-wide">{ov.code}</span>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => copy('code', ov.code)} aria-label={t('refz.copy_code', 'Copy code')}>
              {copied === 'code' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}<span className="ms-1">{t('refz.copy', 'Copy')}</span>
            </Button>
            {ov.edits_left > 0 && !ov.disabled && (
              <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => { setDraft(ov.code); setEditing(true); }}>
                <Pencil className="w-4 h-4 me-1" />{t('refz.edit_once', 'Change once')}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="refz-code">{t('refz.new_code', 'New code (you can change it only once)')}</Label>
            <div className="flex flex-wrap gap-2">
              <Input id="refz-code" dir="ltr" value={draft} maxLength={24} onChange={(e) => setDraft(e.target.value.toUpperCase())} className="max-w-xs font-mono rounded-xl"
                aria-invalid={!!problem} aria-describedby="refz-code-help" />
              <Button onClick={save} disabled={!!problem || saving} className="rounded-xl">{saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}{t('refz.save', 'Save')}</Button>
              <Button variant="ghost" onClick={() => setEditing(false)} className="rounded-xl">{t('refz.cancel', 'Cancel')}</Button>
            </div>
            <p id="refz-code-help" className={cn('text-xs', problem ? 'text-destructive' : 'text-muted-foreground')}>
              {problem === 'blocked' ? t('refz.code_blocked', 'Please choose another code.')
                : problem ? t('refz.code_format', 'Use 4 to 24 letters and numbers, groups separated by a dash (for example SAP-MOSTAFA-7K2).')
                : t('refz.code_ok', 'Looks good. Links with your current code will keep working.')}
            </p>
          </div>
        )}
        {locked && (
          <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">{t('refz.share_locked', 'Sharing unlocks when you pass the AI interview and accept the referral terms (see the steps above).')}</p>
        )}
        {ov.previous_code && <p className="text-xs text-muted-foreground">{t('refz.prev_code', 'Your previous code {{code}} still works.', { code: ov.previous_code })}</p>}

        {!locked && <>
        <div className="space-y-1.5">
          <Label>{t('refz.share_link', 'Share link')}</Label>
          <div className="flex flex-wrap gap-2">
            <Input readOnly dir="ltr" value={link} className="max-w-md rounded-xl font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label={t('refz.share_link', 'Share link')} />
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => copy('link', link)}>
              {copied === 'link' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}<span className="ms-1">{t('refz.copy_link', 'Copy link')}</span>
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t('refz.share_with', 'Share with a ready message')}</span>
            <div role="group" aria-label={t('refz.msg_lang', 'Message language')} className="inline-flex rounded-lg border border-border p-0.5 text-xs">
              {(['en', 'ar'] as const).map((l) => (
                <button key={l} type="button" onClick={() => setMsgLang(l)} aria-pressed={msgLang === l}
                  className={cn('rounded-md px-2 py-1', msgLang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                  {l === 'en' ? 'English' : 'العربية'}
                </button>
              ))}
            </div>
          </div>
          <p dir={msgLang === 'ar' ? 'rtl' : 'ltr'} className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">{msg.text}</p>
          <div className="flex flex-wrap gap-2">
            {channels.map(([c, label, Icon]) => (
              <Button key={c} variant="outline" size="sm" className="rounded-xl" onClick={() => open(c)} disabled={ov.disabled}>
                <Icon className="w-4 h-4 me-1" />{label}
              </Button>
            ))}
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => copy('text', msg.text)}>
              {copied === 'text' ? <Check className="w-4 h-4 me-1" /> : <Copy className="w-4 h-4 me-1" />}{t('refz.copy_text', 'Copy text')}
            </Button>
            <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setShowQR((v) => !v)} aria-expanded={showQR}>
              <QrCode className="w-4 h-4 me-1" />{t('refz.qr', 'QR code')}
            </Button>
          </div>
          {showQR && <QRCodeDisplay url={link} />}
        </div>
        </>}
      </CardContent>
    </Card>
  );
}

function EarningsCards({ rows, minPayout }: { rows: EarningsRow[]; minPayout: number }) {
  const { t } = useTranslation();
  const f = useFormat();
  const list = rows.length ? rows : [{ currency: 'USD', pending: 0, available: 0, held: 0, in_payout: 0, paid: 0, lifetime: 0 }];
  return (
    <div className="space-y-3">
      {list.map((r) => (
        <div key={r.currency} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {([
            ['pending', t('refz.pending', 'Pending'), r.pending + r.held, t('refz.pending_hint', 'Waiting until the referred consultant\'s payout is completed')],
            ['available', t('refz.available', 'Available'), r.available + r.in_payout, t('refz.available_hint', 'Paid with the next payout run once it reaches {{min}}', { min: f.money(minPayout, r.currency) })],
            ['paid', t('refz.paid', 'Paid'), r.paid, t('refz.paid_hint', 'Transferred to your bank account')],
            ['lifetime', t('refz.lifetime', 'Lifetime'), r.lifetime, t('refz.lifetime_hint', 'Everything earned, after any reversals')],
          ] as Array<[string, string, number, string]>).map(([k, label, v, hint]) => (
            <Card key={k} className="rounded-2xl">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-bold text-foreground tabular-nums">{f.money(v, r.currency)}</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ReferAndEarnPage() {
  const { t } = useTranslation();
  const f = useFormat();
  const { isGuest } = useGuestMode();
  const overview = useReferralOverview(!isGuest);
  const ov = overview.data?.data ?? null;
  const loaded = !!ov;
  const active = !!ov && ov.activation.active;
  const list = useMyReferralList(loaded);
  const history = useMyReferralHistory(loaded);
  const invite = useMyReferralInvite(loaded);
  const invalidate = useInvalidateReferral();
  const nextText = useNextStepText();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'calculations' ? 'calculations' : 'overview';

  // Until the programme SQL is applied (or for demo visitors) the existing member referral page stays.
  if (isGuest || (overview.data && !overview.data.available)) return <ReferralsPage />;

  if (overview.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-40 w-full rounded-2xl" /><Skeleton className="h-28 w-full rounded-2xl" /></div>;
  }
  if (!ov) {
    return (
      <Card className="rounded-2xl"><CardContent className="p-6 space-y-3 text-sm">
        <p>{rpcMessage({ message: overview.data?.error }, t('refz.load_failed', 'Your referral page could not be loaded.'))}</p>
        <Button variant="outline" onClick={() => overview.refetch()} className="rounded-xl">{t('refz.retry', 'Try again')}</Button>
      </CardContent></Card>
    );
  }

  const s = ov.settings;
  const rate = formatRate(s.rate_percent);
  const badges = referrerBadges(ov.funnel.verified);
  const missing = [
    !ov.eligibility.verified && t('refz.need_verified', 'Your profile must be verified.'),
    !ov.eligibility.policy && t('refz.need_policy', 'Please accept the Consultant Service Policy.'),
    ov.eligibility.suspended && t('refz.need_active', 'Your account is suspended.'),
    !ov.eligibility.payout_details && t('refz.need_bank', 'Add your bank details (Earnings, Bank details) to receive payouts.'),
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Gift className="w-6 h-6 text-primary" />{t('refz.title', 'Refer & earn')}</h1>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={openReferralIntro}>{t('refz.help_intro', 'Refer & earn: how it works')}</Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground max-w-3xl">
          {t('refz.pitch', 'Earn {{rate}} % of the fees of every consultant you bring for {{months}} months - paid by AI Support 360, never deducted from them.', { rate, months: s.months })}
        </p>
      </div>

      {!s.enabled && (
        <Card className="rounded-2xl border-warning/40"><CardContent className="p-4 text-sm">{t('refz.paused', 'The referral programme is paused at the moment. Rewards already earned stay yours.')}</CardContent></Card>
      )}

      <Tabs value={tab} onValueChange={(v) => { const n = new URLSearchParams(params); if (v === 'overview') n.delete('tab'); else n.set('tab', v); setParams(n, { replace: true }); }}>
        <TabsList>
          <TabsTrigger value="overview">{t('refz.tab_overview', 'Overview')}</TabsTrigger>
          <TabsTrigger value="calculations">{t('refz.tab_calc', 'Referral calculations')}</TabsTrigger>
        </TabsList>
        <TabsContent value="calculations" className="mt-4"><ReferralCalculations code={ov.code} /></TabsContent>
        <TabsContent value="overview" className="mt-4 space-y-6">
      {invite.data && <InviteCard invite={invite.data} onDone={invalidate} />}
      {!active && <ReferrerActivationCard ov={ov} onDone={invalidate} />}
      {(
        <>
          {missing.length > 0 && (
            <Card className="rounded-2xl border-warning/40">
              <CardContent className="p-4 text-sm flex gap-3">
                <ShieldAlert className="w-5 h-5 shrink-0 text-warning" aria-hidden />
                <div>
                  <p className="font-medium">{t('refz.to_earn', 'To earn and receive rewards:')}</p>
                  <ul className="mt-1 list-disc ps-5 text-muted-foreground">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
                </div>
              </CardContent>
            </Card>
          )}

          <CodeCard ov={ov} locked={!active} />

          <section aria-labelledby="refz-earn-h" className="space-y-3">
            <h2 id="refz-earn-h" className="text-base font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-primary" />{t('refz.earnings', 'Your earnings')}</h2>
            <EarningsCards rows={ov.earnings} minPayout={s.min_payout} />
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="rounded-2xl lg:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4 text-primary" />{t('refz.funnel', 'Your referrals so far')}</CardTitle></CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  {([
                    [t('refz.f_clicks', 'Link visits'), ov.funnel.clicks],
                    [t('refz.f_signups', 'Signed up'), ov.funnel.signups],
                    [t('refz.f_verified', 'Verified'), ov.funnel.verified],
                    [t('refz.f_paying', 'First paid ticket'), ov.funnel.paying],
                  ] as Array<[string, number]>).map(([label, v]) => (
                    <div key={label} className="rounded-xl bg-muted/40 p-3">
                      <dd className="text-xl font-bold tabular-nums">{f.num(v)}</dd>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-[11px] text-muted-foreground">{t('refz.f_note', 'Link visits are counted without storing anything about the visitor.')}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Award className="w-4 h-4 text-primary" />{t('refz.badges', 'Referrer badges')}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {badges.map((b) => (
                  <span key={b.at} className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium',
                    b.earned ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                    {b.earned ? <Check className="w-3 h-3" aria-hidden /> : null}
                    {t('refz.badge', 'Verified referrals: {{n}}', { n: b.at })}
                    <span className="sr-only">{b.earned ? t('refz.badge_earned', 'earned') : t('refz.badge_not_yet', 'not yet')}</span>
                  </span>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-base">{t('refz.list', 'Consultants you referred')}</CardTitle></CardHeader>
            <CardContent className="p-0">
              {list.isLoading ? <div className="p-4"><Skeleton className="h-16 w-full" /></div>
                : (list.data ?? []).length === 0 ? <p className="p-6 text-sm text-muted-foreground">{t('refz.list_empty', 'No one has signed up with your code yet.')}</p>
                : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t('refz.c_name', 'Consultant')}</TableHead>
                        <TableHead>{t('refz.c_activation', 'Activation')}</TableHead>
                        <TableHead>{t('refz.c_status', 'Status')}</TableHead>
                        <TableHead>{t('refz.c_joined', 'Signed up')}</TableHead>
                        <TableHead>{t('refz.c_first', 'First paid ticket')}</TableHead>
                        <TableHead>{t('refz.c_ends', 'Rewards until')}</TableHead>
                        <TableHead className="text-end">{t('refz.c_earned', 'Earned')}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {(list.data ?? []).map((r, i) => (
                          <TableRow key={`${r.referred_name}-${r.attributed_at}-${i}`}>
                            <TableCell className="font-medium" dir="auto">{r.referred_name}</TableCell>
                            <TableCell className="text-xs min-w-[220px]">
                              <ChipBadge chip={r.chip} />
                              {r.activation_status === 'pending' && (
                                <div className="mt-1 space-y-0.5 text-muted-foreground">
                                  <div>{r.they_passed ? '✓' : '○'} {t('refz.t_they_passed', 'They passed the AI interview')}</div>
                                  <div>{r.they_acknowledged ? '✓' : '○'} {t('refz.t_they_acked', 'They accepted the terms')}</div>
                                  <div className="text-foreground">{r.chip === 'waiting_you'
                                    ? <>{t('refz.your_next', 'Your next step:')} {nextText(r.my_next, r.referred_name, ov.activation.pass_mark)}</>
                                    : <>{t('refz.their_next', 'Their next step:')} {nextText(r.their_next, r.referred_name, ov.activation.pass_mark)}</>}</div>
                                  {r.activation_expires_at && <div>{t('refz.deadline', 'Deadline: {{date}}', { date: f.date(r.activation_expires_at) })}</div>}
                                </div>
                              )}
                              {r.activation_status === 'active' && r.activated_at && <div className="mt-1 text-muted-foreground">{t('refz.active_since', 'Active since {{date}}', { date: f.date(r.activated_at) })}</div>}
                            </TableCell>
                            <TableCell><span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[r.status])}>{t(`refz.st_${r.status}`, REFERRAL_STATUS_LABEL[r.status as ReferralStatus] ?? r.status)}</span></TableCell>
                            <TableCell className="text-sm">{f.date(r.attributed_at)}</TableCell>
                            <TableCell className="text-sm">{f.date(r.first_paid_at)}</TableCell>
                            <TableCell className="text-sm">{r.window_ends_at ? f.date(r.window_ends_at) : t('refz.starts_first_paid', 'Starts with the first paid ticket')}</TableCell>
                            <TableCell className="text-end text-sm tabular-nums">
                              {Object.keys(r.earned ?? {}).length ? Object.entries(r.earned).map(([c, v]) => <div key={c}>{f.money(Number(v), c)}</div>) : '-'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-base">{t('refz.history', 'Reward history')}</CardTitle></CardHeader>
            <CardContent className="p-0">
              {history.isLoading ? <div className="p-4"><Skeleton className="h-16 w-full" /></div>
                : (history.data ?? []).length === 0 ? <p className="p-6 text-sm text-muted-foreground">{t('refz.history_empty', 'No rewards yet. They appear when a consultant you referred is paid for their work.')}</p>
                : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>{t('refz.h_date', 'Date')}</TableHead>
                        <TableHead>{t('refz.h_what', 'What')}</TableHead>
                        <TableHead className="text-end">{t('refz.h_fee', 'Their fee')}</TableHead>
                        <TableHead className="text-end">{t('refz.h_amount', 'Your reward')}</TableHead>
                        <TableHead>{t('refz.h_status', 'Status')}</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {(history.data ?? []).map((l, i) => (
                          <TableRow key={`${l.created_at}-${i}`}>
                            <TableCell className="text-sm">{f.date(l.created_at)}</TableCell>
                            <TableCell className="text-sm">
                              {l.kind === 'reward' ? t('refz.k_reward', 'Reward ({{rate}} %) from {{name}}', { rate: formatRate(Number(l.rate_percent) || 0), name: l.referred_name ?? '' })
                                : l.kind === 'reversal' ? t('refz.k_reversal', 'Reversal (refund or correction)')
                                : t('refz.k_adjust', 'Adjustment by AI Support 360')}
                              {l.note && l.kind !== 'reward' && <div className="text-xs text-muted-foreground">{l.note}</div>}
                            </TableCell>
                            <TableCell className="text-end text-sm tabular-nums">{l.fee_amount != null && l.kind === 'reward' ? f.money(Number(l.fee_amount), l.currency) : '-'}</TableCell>
                            <TableCell className={cn('text-end text-sm font-semibold tabular-nums', l.amount < 0 && 'text-destructive')}>{f.money(l.amount, l.currency)}</TableCell>
                            <TableCell><span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[l.status])}>{t(`refz.ls_${l.status}`, LINE_STATUS_LABEL[l.status as LineStatus] ?? l.status)}</span></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Info className="w-4 h-4 text-primary" />{t('refz.how', 'How it works')}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ol className="list-decimal ps-5 space-y-1 text-muted-foreground">
                <li>{t('refz.how_1', 'Share your link or code with SAP consultants you know.')}</li>
                <li>{t('refz.how_2', 'They sign up with it and get verified.')}</li>
                <li>{t('refz.how_2b', 'The referral becomes active when you both pass the AI interview (score at least {{pass}}) and both accept the terms, within {{days}} days of their sign-up.', { pass: ov.activation.pass_mark, days: s.activation_days })}</li>
                <li>{t('refz.how_3', 'For {{months}} months from their first paid ticket you earn {{rate}} % of their fee for every approved hour invoiced after activation. AI Support 360 pays it from its own fee.', { months: s.months, rate })}</li>
                <li>{t('refz.how_4', 'A reward is pending until their payout is completed, then available. From {{min}} it is paid with the normal payout run to your bank details.', { min: f.money(s.min_payout) })}</li>
              </ol>
              <p className="rounded-xl bg-muted/40 p-3">
                {t('refz.example', 'Example: a consultant at {{hourly}} per hour works one man-day (8 approved hours). You earn {{reward}}.', { hourly: f.money(100), reward: f.money(rewardPerManDay(100, s.rate_percent)) })}
              </p>
              <p className="text-xs text-muted-foreground">
                <Badge variant="outline" className="me-1 text-[10px]">{t('refz.draft', 'Draft')}</Badge>
                {t('refz.tax', 'Referral rewards may be taxable. You are responsible for declaring them where you live.')}{' '}
                <Link to="/referral-terms" className="text-primary underline">{t('refz.terms_link', 'referral programme terms')}</Link>
              </p>
              <p className="text-xs text-muted-foreground">{t('refz.honest', 'No income is promised: you earn only when a consultant you referred is paid for real work.')}</p>
            </CardContent>
          </Card>
        </>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
