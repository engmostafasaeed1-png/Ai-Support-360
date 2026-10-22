import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReferralCalculations from '@/components/referral/ReferralCalculations';
import { openReferralIntro } from '@/components/referral/ReferEarnStepHost';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Award, Check, Copy, Gift, Link2, Loader2, Mail, MessageCircle, Pencil, QrCode, Send, Share2, ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import QRCodeDisplay from '@/components/referral/QRCodeDisplay';
import ReferralsPage from '@/pages/ReferralsPage';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useQueryClient } from '@tanstack/react-query';
import {
  referralRpc, rpcMessage, useInvalidateReferral, useMyReferralHistory, useMyReferralInvite, useMyReferralList, useReferralOverview,
  type ReferralOverview,
} from '@/hooks/useReferralProgram';
import {
  markReferPageOpened, useReferralPayouts, useReferralRewardLines, useReferralTrackingInfo,
} from '@/hooks/useReferralTracking';
import {
  rateRangeText, settingsTiers, normalizeReferralCode, referralCodeProblem, referralLink, referrerBadges,
  shareMessage, shareUrl, type ShareChannel,
} from '@/lib/referrals';
import { linesFromHistory } from '@/lib/referralTracking';
import { cn } from '@/lib/utils';
import { InviteCard, ReferrerActivationCard } from '@/components/referral/ReferralActivation';
import ReferralShortTerms from '@/components/referral/ReferralShortTerms';
import ReferralRulesHub from '@/components/referral/rules/ReferralRulesHub';
import ReferralPolicyCards from '@/components/referral/tracking/ReferralPolicyCards';
import ReferralJourney, { type ReferTab } from '@/components/referral/tracking/ReferralJourney';
import ReferralFunnelList from '@/components/referral/tracking/ReferralFunnelList';
import ReferralEarnings from '@/components/referral/tracking/ReferralEarnings';
import RewardCalcBox from '@/components/referral/tracking/RewardCalcBox';


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
      month: (iso: string) => new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(iso)),
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
    ['email', t('refz.email_own', 'Open in my mail app'), Mail],
  ];

  return (
    <Card id="refz-code-card" tabIndex={-1} className="rounded-2xl scroll-mt-28 outline-none">
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
          <p className="text-xs text-muted-foreground">{t('refz.own_mail_hint', 'E-mail opens your own mail app with the message filled in, so it is sent from your address. AI Support 360 never e-mails colleagues who have not registered.')}</p>
          {showQR && <QRCodeDisplay url={link} />}
        </div>
        </>}
      </CardContent>
    </Card>
  );
}

const TABS: ReferTab[] = ['overview', 'programme', 'referrals', 'earnings', 'calculations'];

export default function ReferAndEarnPage() {
  const { t } = useTranslation();
  const f = useFormat();
  const { isGuest } = useGuestMode();
  const qc = useQueryClient();
  const overview = useReferralOverview(!isGuest);
  const ov = overview.data?.data ?? null;
  const loaded = !!ov;
  const active = !!ov && ov.activation.active;
  const list = useMyReferralList(loaded);
  const history = useMyReferralHistory(loaded);
  const invite = useMyReferralInvite(loaded);
  const lines = useReferralRewardLines(loaded);
  const payouts = useReferralPayouts(loaded);
  const tracking = useReferralTrackingInfo(loaded);
  const invalidateBase = useInvalidateReferral();
  const invalidate = () => {
    invalidateBase();
    for (const k of ['referral-reward-lines', 'referral-payouts', 'referral-tracking', 'referral-nav-state']) qc.invalidateQueries({ queryKey: [k] });
  };
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as ReferTab | null;
  const tab: ReferTab = raw && TABS.includes(raw) ? raw : 'overview';
  const setTab = (v: ReferTab) => {
    const n = new URLSearchParams(params);
    if (v === 'overview') n.delete('tab'); else n.set('tab', v);
    setParams(n, { replace: true });
    window.requestAnimationFrame(() => document.getElementById('refz-tabs')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  // Opening the page stops the menu pulse and clears the "new earnings" dot.
  useEffect(() => { if (loaded) markReferPageOpened(); }, [loaded]);

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
  const tiers = settingsTiers(s);
  const rate = rateRangeText(tiers);
  const badges = referrerBadges(ov.funnel.verified);
  const referrals = list.data ?? [];
  const mainCur = ov.earnings[0]?.currency ?? 'USD';
  const money1 = (v: number) => f.money(v, mainCur);
  const detailed = lines.data?.available === true;
  const rewardLines = detailed ? lines.data!.data : linesFromHistory((history.data ?? []) as unknown as Array<Record<string, unknown>>);
  const missing = [
    !ov.eligibility.verified && t('refz.need_verified', 'Your profile must be verified.'),
    !ov.eligibility.policy && t('refz.need_policy', 'Please accept the Consultant Service Policy.'),
    ov.eligibility.suspended && t('refz.need_active', 'Your account is suspended.'),
    !ov.eligibility.payout_details && t('refz.need_bank', 'Add your bank details (Earnings, Bank details) to receive payouts.'),
  ].filter(Boolean) as string[];
  const goShare = () => {
    const el = document.getElementById('refz-code-card');
    if (tab !== 'overview') setTab('overview');
    window.setTimeout(() => { const x = document.getElementById('refz-code-card') ?? el; x?.scrollIntoView({ behavior: 'smooth', block: 'start' }); x?.focus({ preventScroll: true }); }, 60);
  };
  const goSimulator = () => {
    setTab('programme');
    window.setTimeout(() => { const x = document.getElementById('refz-rules-simulator'); x?.scrollIntoView({ behavior: 'smooth', block: 'start' }); x?.focus({ preventScroll: true }); }, 120);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Gift className="w-6 h-6 text-primary" />{t('refz.title', 'Refer & earn')}</h1>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={openReferralIntro}>{t('refz.help_intro', 'Refer & earn: how it works')}</Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground max-w-3xl">
          {t('refz.pitch', 'Earn {{rate}} % of the fees of every consultant you bring for {{months}} months - the more verified consultants you refer, the higher your rate. Paid by AI Support 360, never deducted from them.', { rate, months: s.months })}
        </p>
      </div>

      {!s.enabled && (
        <Card className="rounded-2xl border-warning/40"><CardContent className="p-4 text-sm">{t('refz.paused', 'The referral programme is paused at the moment. Rewards already earned stay yours.')}</CardContent></Card>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as ReferTab)}>
        <div id="refz-tabs" className="scroll-mt-28 -mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="overview">{t('refz.tab_overview', 'Overview')}</TabsTrigger>
            <TabsTrigger value="programme">{t('reft.tab_programme', 'Programme & policy')}</TabsTrigger>
            <TabsTrigger value="referrals">{t('reft.tab_referrals', 'My referrals')}{referrals.length ? ` (${f.num(referrals.length)})` : ''}</TabsTrigger>
            <TabsTrigger value="earnings">{t('reft.tab_earnings', 'Earnings & payouts')}</TabsTrigger>
            <TabsTrigger value="calculations">{t('refz.tab_calc', 'Referral calculations')}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4 space-y-6">
          {invite.data && <InviteCard invite={invite.data} onDone={invalidate} />}
          {!active && <ReferrerActivationCard ov={ov} onDone={invalidate} />}
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
          <ReferralJourney ov={ov} referrals={referrals} num={f.num} onTab={setTab} onShare={goShare} />
          <CodeCard ov={ov} locked={!active} />
          <div className="grid gap-4 lg:grid-cols-2">
            <RewardCalcBox tiers={tiers} tierCount={ov.tier_count} ownRate={ov.sim_defaults.own_rate} platformRate={ov.sim_defaults.platform_rate} money={money1} onSimulator={goSimulator} />
            <Card className="rounded-2xl">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Award className="w-4 h-4 text-primary" />{t('refz.badges', 'Referrer badges')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {badges.map((b) => (
                    <span key={b.at} className={cn('inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium',
                      b.earned ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                      {b.earned ? <Check className="w-3 h-3" aria-hidden /> : null}
                      {t('refz.badge', 'Verified referrals: {{n}}', { n: b.at })}
                      <span className="sr-only">{b.earned ? t('refz.badge_earned', 'earned') : t('refz.badge_not_yet', 'not yet')}</span>
                    </span>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  {([
                    [t('refz.pending', 'Pending'), ov.earnings.reduce((n, e) => n + e.pending + e.held, 0)],
                    [t('refz.available', 'Available'), ov.earnings.reduce((n, e) => n + e.available + e.in_payout, 0)],
                    [t('refz.paid', 'Paid'), ov.earnings.reduce((n, e) => n + e.paid, 0)],
                  ] as Array<[string, number]>).map(([l, v]) => (
                    <div key={l} className="rounded-xl bg-muted/40 p-2"><p className="text-muted-foreground">{l}</p><p className="font-semibold tabular-nums">{money1(v)}</p></div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="rounded-xl" onClick={() => setTab('earnings')}>{t('reft.see_earnings', 'See earnings and payouts')}</Button>
              </CardContent>
            </Card>
          </div>
          <ReferralShortTerms holdDays={s.hold_days} minInvoice={s.min_invoice} />
        </TabsContent>

        <TabsContent value="programme" className="mt-4">
          <ReferralRulesHub ov={ov} referrals={referrals} money={money1} date={f.date} onDone={invalidate}
            policy={(
              <ReferralPolicyCards s={s} tiers={tiers} passMark={ov.activation.pass_mark} money={money1} date={f.date}
                terms={tracking.data?.data.terms ?? null} acceptedVersion={ov.terms_accepted_version}
                canAccept={ov.activation.interview_passed} onDone={invalidate} />
            )} />
        </TabsContent>

        <TabsContent value="referrals" className="mt-4 space-y-4">
          <ReferralJourney ov={ov} referrals={referrals} num={f.num} onTab={setTab} onShare={goShare} />
          <ReferralFunnelList referrals={referrals} rejected={tracking.data?.data.rejected ?? []} loading={list.isLoading}
            passMark={ov.activation.pass_mark} date={f.date} money={f.money} />
        </TabsContent>

        <TabsContent value="earnings" className="mt-4">
          <ReferralEarnings lines={rewardLines} loading={lines.isLoading || (!detailed && history.isLoading)} detailed={detailed}
            payouts={payouts.data?.data ?? []} payoutsAvailable={payouts.data?.available === true}
            tiers={tiers} tierCount={ov.tier_count} minPayout={s.min_payout} payoutDetails={ov.eligibility.payout_details}
            money={f.money} date={f.date} month={f.month} />
        </TabsContent>

        <TabsContent value="calculations" className="mt-4"><ReferralCalculations code={ov.code} /></TabsContent>
      </Tabs>
    </div>
  );
}
