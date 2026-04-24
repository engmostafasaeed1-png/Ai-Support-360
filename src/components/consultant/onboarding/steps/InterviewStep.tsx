import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Brain, Play, SkipForward, CheckCircle, Medal, ShieldCheck, Sparkles, Star } from 'lucide-react';
import AIInterviewFlow from '@/components/consultant/AIInterviewFlow';
import { TrustBadge } from '@/components/consultant/TrustBadge';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { toast } from 'sonner';

const TIERS = [
  { name: 'Gold',     range: 'Score 85+',  credits: 150, icon: Medal,       cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 ring-amber-300/60' },
  { name: 'Silver',   range: 'Score 70–84', credits: 100, icon: Medal,       cls: 'bg-slate-200 text-slate-800 dark:bg-slate-700/40 dark:text-slate-200 ring-slate-300/60' },
  { name: 'Bronze',   range: 'Score 50–69', credits: 75,  icon: Medal,       cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 ring-orange-300/60' },
  { name: 'Verified', range: 'Any score',  credits: 50,  icon: ShieldCheck, cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 ring-emerald-300/60' },
] as const;

interface Props {
  onInterviewComplete: () => void;
  consultantId?: string;
}

export default function InterviewStep({ onInterviewComplete, consultantId }: Props) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const { data: profile } = useConsultantProfile();
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [completed, setCompleted] = useState(false);

  const currentBadge = profile?.ai_interview_badge ?? null;
  const currentCredits = profile?.credibility_credits ?? 0;

  const startInterview = async () => {
    if (isGuest) {
      toast.success('Demo: AI Interview would start here');
      setCompleted(true);
      onInterviewComplete();
      return;
    }

    if (!consultantId) {
      toast.error('Please complete previous steps first');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('interview_sessions')
        .insert({
          consultant_id: consultantId,
          status: 'pending',
          interview_type: 'ai',
        })
        .select('id')
        .single();
      if (error) throw error;
      setInterviewId(data.id);
      setStarted(true);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to start interview');
    }
  };

  if (completed) {
    return (
      <Card className="p-6 text-center space-y-4">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
        <h3 className="text-lg font-semibold">Interview Complete!</h3>
        <p className="text-sm text-muted-foreground">
          Your AI interview has been submitted. Results will be factored into your profile verification.
        </p>
      </Card>
    );
  }

  if (started && interviewId) {
    return (
      <AIInterviewFlow
        interviewId={interviewId}
        onComplete={() => {
          setCompleted(true);
          onInterviewComplete();
        }}
        onCancel={() => setStarted(false)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-6 space-y-5">
        {/* Header */}
        <div className="text-center space-y-3">
          <Brain className="w-12 h-12 text-primary mx-auto" />
          <h3 className="text-lg font-semibold flex items-center justify-center gap-2">
            AI Skills Assessment
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Optional</span>
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Take a quick AI-powered interview to verify your SAP skills. Earn a tier badge plus credibility credits — both shown to clients on your profile and in match results.
          </p>

          <div className="grid grid-cols-3 gap-3 text-center max-w-sm mx-auto pt-2">
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-lg font-bold text-foreground">6</p>
              <p className="text-[10px] text-muted-foreground">Questions</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-lg font-bold text-foreground">~15</p>
              <p className="text-[10px] text-muted-foreground">Minutes</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30">
              <p className="text-lg font-bold text-foreground">AI</p>
              <p className="text-[10px] text-muted-foreground">Scored</p>
            </div>
          </div>
        </div>

        {/* Badge preview */}
        <div className="rounded-xl border border-border/60 bg-gradient-to-br from-violet-500/5 via-background to-amber-500/5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                {currentBadge ? 'Your current profile preview' : 'Preview after completion'}
              </p>
              <p className="text-sm font-semibold text-foreground mt-0.5">
                {currentBadge ? `You're at ${currentBadge} tier` : 'Sample: Silver tier'}
              </p>
            </div>
            <TrustBadge
              badge={currentBadge ?? 'Silver'}
              credits={currentBadge ? currentCredits : 100}
              size="md"
            />
          </div>
          {!currentBadge && (
            <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              Complete the interview to unlock your real badge & credits.
            </p>
          )}
        </div>

        {/* Tier rewards table */}
        <div>
          <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
            <Star className="w-3.5 h-3.5 text-amber-500" />
            Exact rewards per tier (one-time, on first completion)
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {TIERS.map((tier) => {
              const Icon = tier.icon;
              const active = currentBadge === tier.name;
              return (
                <div
                  key={tier.name}
                  className={`flex items-center justify-between rounded-lg border p-3 transition-all ${
                    active ? `ring-2 ${tier.cls.split(' ').filter(c => c.startsWith('ring-')).join(' ')} border-transparent` : 'border-border/50'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${tier.cls}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">
                        {tier.name}
                        {active && <span className="ms-1 text-[10px] font-semibold text-muted-foreground">· you</span>}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{tier.range}</p>
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <p className="text-sm font-black text-foreground">+{tier.credits}</p>
                    <p className="text-[10px] text-muted-foreground">credits</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-center pt-1">
          <Button variant="outline" onClick={onInterviewComplete} className="gap-1.5">
            <SkipForward className="w-4 h-4" />
            Skip for Now
          </Button>
          <Button onClick={startInterview} className="gap-1.5">
            <Play className="w-4 h-4" />
            {currentBadge ? 'Retake Interview' : 'Start & Earn Badge'}
          </Button>
        </div>
      </Card>

      <p className="text-xs text-center text-muted-foreground">
        Credits are awarded once on first completion. Retaking only updates your tier and score.
      </p>
    </div>
  );
}

