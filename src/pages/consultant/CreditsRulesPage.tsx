import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sparkles, Medal, ShieldCheck, Brain, Star, ArrowUpRight,
  TrendingUp, Award, Zap, Users, CheckCircle2, Info, History,
} from 'lucide-react';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import { TrustBadge } from '@/components/consultant/TrustBadge';
import { supabase } from '@/integrations/supabase/client';

interface Tier {
  name: string;
  minScore: number;
  credits: number;
  color: string;
  ring: string;
  icon: typeof Medal;
}

const TIERS: Tier[] = [
  { name: 'Gold',     minScore: 85, credits: 150, color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',     ring: 'ring-amber-300/60',   icon: Medal },
  { name: 'Silver',   minScore: 70, credits: 100, color: 'bg-slate-200 text-slate-800 dark:bg-slate-700/40 dark:text-slate-200',    ring: 'ring-slate-300/60',   icon: Medal },
  { name: 'Bronze',   minScore: 50, credits: 75,  color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', ring: 'ring-orange-300/60',  icon: Medal },
  { name: 'Verified', minScore: 0,  credits: 50,  color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300', ring: 'ring-emerald-300/60', icon: ShieldCheck },
];

// What is awarded today: every award is written to the credit history by the database.
const EARN_ACTIONS = [
  { icon: Brain,        title: 'Complete the AI Interview', credits: '50–150', detail: 'One-time award based on your overall score tier.', cta: { label: 'Start Interview', to: '/consultant/interviews' } },
  { icon: ShieldCheck,  title: 'Get fully verified',         credits: '+40',   detail: 'Awarded once, when the platform team verifies your profile.', cta: { label: 'Verification', to: '/consultant/verification' } },
  { icon: Star,         title: 'Earn a 5-star review',       credits: '+10',   detail: 'Each 5-star client review. The 10 credits are taken back if the review is removed.', cta: { label: 'My Reviews', to: '/consultant/reviews' } },
];

// Planned, not awarded yet.
const COMING_SOON_EARN = [
  { icon: Award, title: 'Link a Credly badge',  detail: 'A bonus for each linked certification.' },
  { icon: Zap,   title: 'Fast response time',   detail: 'A weekly bonus for answering match requests quickly.' },
];

// Planned, not available yet.
const PLANNED_PERKS = [
  { icon: TrendingUp, title: 'Higher match priority',    detail: 'A boost to the top of client recommendations.' },
  { icon: Users,      title: 'Featured on landing page', detail: 'Showcased in the public consultants section.' },
  { icon: Zap,        title: 'Premium bidding',          detail: 'Place a bid on premium client tickets.' },
  { icon: Award,      title: 'Premium badge on profile', detail: 'A permanent ribbon on your profile for a period.' },
];

const RULES = [
  'Credits never expire while your account is active and in good standing.',
  'Credits are non-transferable and have no cash value. For now they are shown on your profile as a trust signal to clients.',
  'Re-taking the AI interview updates your tier and score, but the credit reward is granted only on first completion.',
  'Credits are taken back when the action behind them is reversed: the 10 credits of a 5-star review are removed if the review is removed.',
  'Every change of your balance is listed in your credit history on this page.',
  'Inviting a member earns a separate USD referral credit (see Referrals); it does not change your credibility credits.',
  'Abuse, spam, or fake activity may result in credit forfeiture and account review.',
];

const REASONS: Record<string, string> = {
  opening_balance: 'Balance before the credit history existed',
  ai_interview: 'AI interview reward',
  fully_verified: 'Fully verified',
  five_star_review: '5-star review',
  review_removed: '5-star review removed',
  adjustment: 'Adjustment by the platform team',
};

function CreditHistory({ consultantId }: { consultantId: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['credit-ledger', consultantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('credit_ledger')
        .select('id, amount, reason, note, created_at')
        .eq('consultant_id', consultantId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <History className="w-4 h-4 text-primary" /> Your credit history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No credits yet. Your first award appears here.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{REASONS[r.reason] || r.reason}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {new Date(r.created_at).toLocaleDateString()}{r.note ? ` · ${r.note}` : ''}
                  </p>
                </div>
                <span className={`text-sm font-bold shrink-0 ${r.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
                  {r.amount > 0 ? '+' : ''}{r.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function CreditsRulesPage() {
  const { data: profile } = useConsultantProfile();

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Hero */}
      <Card className="rounded-2xl border-border/50 overflow-hidden bg-gradient-to-br from-violet-500/10 via-background to-amber-500/5">
        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row md:items-center gap-6 justify-between">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 mb-3">
                <Badge variant="secondary" className="bg-violet-500/10 text-violet-700 dark:text-violet-300 border-0">
                  <Sparkles className="w-3 h-3 me-1" /> Credibility Credits
                </Badge>
              </div>
              <h1 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">
                How credibility credits work
              </h1>
              <p className="text-muted-foreground mt-2 max-w-2xl">
                Credibility credits are the trust score of the portal. You earn them by proving your skills and serving clients well,
                and clients see them on your profile. The ways to earn credits that work today are listed below;
                more ways and perks are planned.
              </p>
            </div>

            {profile && (
              <div className="rounded-2xl bg-card border border-border/60 p-4 min-w-[200px] shadow-sm">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Your balance</p>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-3xl font-black text-foreground">{profile.credibility_credits ?? 0}</span>
                  <span className="text-sm text-muted-foreground">credits</span>
                </div>
                <div className="mt-3">
                  <TrustBadge badge={profile.ai_interview_badge} credits={null} size="md" />
                  {!profile.ai_interview_badge && (
                    <p className="text-[11px] text-muted-foreground">Complete your AI interview to earn a tier.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tier table */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Medal className="w-4 h-4 text-amber-500" /> AI Interview tiers & first-time rewards
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {TIERS.map((tier) => {
              const Icon = tier.icon;
              const active = profile?.ai_interview_badge === tier.name;
              return (
                <div
                  key={tier.name}
                  className={`rounded-xl p-4 border transition-all ${active ? `border-transparent ring-2 ${tier.ring} shadow-sm` : 'border-border/50'}`}
                >
                  <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${tier.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                    {tier.name}
                    {active && <span className="text-[10px] font-semibold opacity-70 ms-1">· you</span>}
                  </div>
                  <p className="text-2xl font-black text-foreground mt-3">+{tier.credits}</p>
                  <p className="text-xs text-muted-foreground">credits, one-time</p>
                  <Separator className="my-3" />
                  <p className="text-xs text-muted-foreground">
                    {tier.minScore > 0 ? <>Score <span className="font-semibold text-foreground">{tier.minScore}+</span></> : 'Any completed interview'}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Credit history */}
      {profile?.id && <CreditHistory consultantId={profile.id} />}

      {/* Earn credits */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" /> Ways to earn credits
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            {EARN_ACTIONS.map((a) => {
              const Icon = a.icon;
              return (
                <div key={a.title} className="rounded-xl border border-border/50 p-4 flex gap-3 hover:border-accent/40 transition-colors">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm text-foreground">{a.title}</h3>
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-0 shrink-0">
                        {a.credits}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{a.detail}</p>
                    <Button asChild variant="link" size="sm" className="px-0 h-auto mt-2 text-xs">
                      <Link to={a.cta.to}>{a.cta.label} <ArrowUpRight className="w-3 h-3 ms-0.5" /></Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {COMING_SOON_EARN.map((a) => {
              const Icon = a.icon;
              return (
                <div key={a.title} className="rounded-xl border border-dashed border-border/60 p-4 flex gap-3 bg-muted/20">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm text-foreground">{a.title}</h3>
                      <Badge variant="outline" className="text-[10px] shrink-0">Coming soon</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{a.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Planned perks */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" /> Planned uses for credits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-3">
            {PLANNED_PERKS.map((b) => {
              const Icon = b.icon;
              return (
                <div key={b.title} className="rounded-xl border border-border/50 p-4 flex gap-3 bg-muted/20">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm text-foreground">{b.title}</h3>
                      <Badge variant="outline" className="text-[10px] shrink-0">Coming soon</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{b.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-4 flex items-start gap-1.5">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            None of these perks can be bought yet. For now your credits are shown on your profile as a trust signal to clients.
          </p>
        </CardContent>
      </Card>

      {/* Rules */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Program rules
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2.5">
            {RULES.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
