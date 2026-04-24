import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sparkles, Medal, ShieldCheck, Brain, Star, Gift, ArrowUpRight,
  TrendingUp, Award, Zap, Users, CheckCircle2, Info,
} from 'lucide-react';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import { TrustBadge } from '@/components/consultant/TrustBadge';

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

const EARN_ACTIONS = [
  { icon: Brain,        title: 'Complete the AI Interview', credits: '50–150', detail: 'One-time award based on your overall score tier.', cta: { label: 'Start Interview', to: '/consultant/interviews' } },
  { icon: ShieldCheck,  title: 'Get fully verified',         credits: '+40',   detail: 'Submit ID, certifications and pass admin review.', cta: { label: 'Verification', to: '/consultant/verification' } },
  { icon: Star,         title: 'Earn a 5-star review',       credits: '+10',   detail: 'Each verified 5-star client review.',              cta: { label: 'My Reviews', to: '/consultant/reviews' } },
  { icon: Award,        title: 'Link a Credly badge',        credits: '+25',   detail: 'One-time per certification, capped at 5 badges.',  cta: { label: 'Edit Profile', to: '/consultant/profile' } },
  { icon: Zap,          title: 'Fast response time',         credits: '+5/wk', detail: 'Reply to match requests within 30 minutes.',       cta: { label: 'Open Requests', to: '/consultant/requests' } },
  { icon: Gift,         title: 'Refer a consultant',         credits: '+50',   detail: 'When your referral completes their first ticket.', cta: { label: 'Referrals', to: '/consultant/referrals' } },
];

const SPEND_BENEFITS = [
  { icon: TrendingUp, title: 'Higher match priority',       cost: '20 credits / boost', detail: 'Boosts you to the top of client recommendations for 7 days.' },
  { icon: Users,      title: 'Featured on landing page',    cost: '100 credits / week', detail: 'Showcased in the public consultants section.' },
  { icon: Zap,        title: 'Unlock open ticket bidding',  cost: '5 credits / bid',    detail: 'Submit a proposal on premium client tickets.' },
  { icon: Award,      title: 'Premium badge on profile',    cost: '250 credits',        detail: 'Display a permanent “Premium” ribbon for 30 days.' },
];

const RULES = [
  'Credits never expire while your account is active and in good standing.',
  'Credits are non-transferable and have no cash value.',
  'Re-taking the AI interview updates your tier and score, but the credit reward is granted only on first completion.',
  'Credits can be revoked if the related action is reversed (e.g. a review is removed for policy violation).',
  'Abuse, spam, or fake activity may result in credit forfeiture and account review.',
];

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
                Credibility credits are the trust currency of the portal. Earn them by proving your skills,
                serving clients well, and growing the community — then spend them on visibility boosts and
                premium features that help you win more business.
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

      {/* Earn credits */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-500" /> Ways to earn credits
          </CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {/* Spend credits */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" /> What you can spend credits on
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-3">
            {SPEND_BENEFITS.map((b) => {
              const Icon = b.icon;
              return (
                <div key={b.title} className="rounded-xl border border-border/50 p-4 flex gap-3 bg-muted/20">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-sm text-foreground">{b.title}</h3>
                      <Badge variant="outline" className="text-[10px] shrink-0">{b.cost}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{b.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground mt-4 flex items-start gap-1.5">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            Some perks roll out gradually. Available perks are listed in your profile and earnings pages.
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
