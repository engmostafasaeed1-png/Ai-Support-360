import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ShieldCheck, Upload, CheckCircle, Clock, XCircle, AlertTriangle,
  FileText, Award, Brain, Play,
} from 'lucide-react';
import CredlyBadgesSection from '@/components/consultant/CredlyBadgesSection';
import InterviewHistory from '@/components/consultant/InterviewHistory';
import AIInterviewFlow from '@/components/consultant/AIInterviewFlow';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';

const verificationSteps = [
  { key: 'identity', label: 'Identity Verification', desc: 'Upload government-issued ID', status: 'completed' },
  { key: 'certifications', label: 'SAP Certifications', desc: 'Upload and verify SAP certificates', status: 'completed' },
  { key: 'experience', label: 'Experience Validation', desc: 'Verify work history and references', status: 'completed' },
  { key: 'skills', label: 'AI Skills Assessment', desc: 'Complete AI-powered skills evaluation', status: 'completed' },
  { key: 'interview', label: 'Technical Interview', desc: 'Pass a brief technical screening', status: 'completed' },
];

const statusIcon: Record<string, typeof CheckCircle> = {
  completed: CheckCircle,
  in_progress: Clock,
  pending: AlertTriangle,
  failed: XCircle,
};

const statusColor: Record<string, string> = {
  completed: 'text-green-500',
  in_progress: 'text-accent',
  pending: 'text-yellow-500',
  failed: 'text-red-500',
};

const verificationBadge: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700' },
  under_review: { label: 'Under Review', color: 'bg-blue-100 text-blue-700' },
  verified: { label: 'Verified', color: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-700' },
  suspended: { label: 'Suspended', color: 'bg-red-100 text-red-700' },
};

export default function VerificationPage() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const { data: consultantProfile } = useConsultantProfile();
  const profile = consultantProfile || { verification_status: 'pending', ai_skills_score: 0 };
  const vBadge = verificationBadge[profile.verification_status] || verificationBadge.pending;
  const completedSteps = verificationSteps.filter((s) => s.status === 'completed').length;
  const progress = Math.round((completedSteps / verificationSteps.length) * 100);
  const [credlyUsername, setCredlyUsername] = useState<string | undefined>(undefined);
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [pendingInterview, setPendingInterview] = useState<{ id: string } | null>(null);
  const [showInterviewFlow, setShowInterviewFlow] = useState(false);
  const [consultantId, setConsultantId] = useState<string | undefined>(undefined);

  // Fetch skills and certifications from DB
  const { data: skills = [] } = useQuery({
    queryKey: ['consultant-skills', consultantId],
    queryFn: async () => {
      if (!consultantId) return [];
      const { data } = await supabase.from('consultant_skills').select('sap_module, proficiency_level, years_experience, certified').eq('consultant_id', consultantId);
      return (data || []).map(s => ({ module: s.sap_module, proficiency: s.proficiency_level || 1, years: s.years_experience || 0, certified: s.certified || false }));
    },
    enabled: !!consultantId,
  });

  const { data: certifications = [] } = useQuery({
    queryKey: ['consultant-certs', consultantId],
    queryFn: async () => {
      if (!consultantId) return [];
      const { data } = await supabase.from('certifications').select('name, issuer, issue_date, verified').eq('consultant_id', consultantId);
      return data || [];
    },
    enabled: !!consultantId,
  });

  useEffect(() => {
    if (isGuest) return;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setUserId(user.id);
      supabase
        .from('consultants')
        .select('id, credly_username')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (!data) return;
          setConsultantId(data.id);
          if ((data as any).credly_username) setCredlyUsername((data as any).credly_username);
          
          // Check for pending AI interviews
          supabase
            .from('interview_sessions')
            .select('id')
            .eq('consultant_id', data.id)
            .eq('interview_type', 'ai' as any)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .then(({ data: interviews }) => {
              if (interviews && interviews.length > 0) {
                setPendingInterview({ id: interviews[0].id });
              }
            });
        });
    });
  }, [isGuest]);

  // Show AI interview flow full-screen
  if (showInterviewFlow && pendingInterview) {
    return (
      <div className="space-y-6">
        <AIInterviewFlow
          interviewId={pendingInterview.id}
          onComplete={() => {
            setShowInterviewFlow(false);
            setPendingInterview(null);
          }}
          onCancel={() => setShowInterviewFlow(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Verification Status</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your verification and credentials.</p>
      </div>

      {/* Pending AI Interview Banner */}
      {pendingInterview && (
        <Card className="rounded-2xl border-primary/30 bg-primary/5">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Brain className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">{t('ai_interview.pending_interview', 'You have a pending AI interview')}</h3>
              <p className="text-sm text-muted-foreground">{t('ai_interview.pending_desc', 'An AI-powered interview has been scheduled for you. Click below to begin.')}</p>
            </div>
            <Button className="gradient-primary border-0 shrink-0" onClick={() => setShowInterviewFlow(true)}>
              <Play className="w-4 h-4 me-2" />
              {t('ai_interview.start_interview', 'Start AI Interview')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Verification Status Card */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center">
                <ShieldCheck className="w-7 h-7 text-primary-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">Verification Progress</h3>
                <p className="text-sm text-muted-foreground">{completedSteps} of {verificationSteps.length} steps completed</p>
              </div>
            </div>
            <Badge className={`${vBadge.color} text-sm px-4 py-1`}>{vBadge.label}</Badge>
          </div>
          <Progress value={progress} className="h-2 mb-6" />

          <div className="space-y-4">
            {verificationSteps.map((step, i) => {
              const Icon = statusIcon[step.status] || Clock;
              return (
                <div key={step.key} className="flex items-center gap-4 p-4 rounded-xl bg-muted/20 border border-border/30">
                  <div className="relative">
                    <Icon className={`w-5 h-5 ${statusColor[step.status]}`} />
                    {i < verificationSteps.length - 1 && (
                      <div className="absolute top-7 left-1/2 w-0.5 h-6 -translate-x-1/2 bg-border" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.desc}</p>
                  </div>
                  <span className={`text-xs font-medium capitalize ${statusColor[step.status]}`}>{step.status.replace('_', ' ')}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* AI Skills Score */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Brain className="w-4 h-4 text-accent" />
            AI Skills Evaluation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6 mb-6">
            <div className="w-24 h-24 rounded-full border-4 border-accent flex items-center justify-center">
              <span className="text-2xl font-bold text-foreground">{profile.ai_skills_score}</span>
            </div>
            <div>
              <p className="font-medium text-foreground">Excellent Performance</p>
              <p className="text-sm text-muted-foreground">You scored in the top 5% of SAP consultants on the platform.</p>
            </div>
          </div>

          <div className="space-y-3">
            {skills.map((skill) => (
              <div key={skill.module} className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground truncate">{skill.module}</span>
                    <div className="flex items-center gap-2">
                      {skill.certified && (
                        <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">Certified</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{skill.years} yrs</span>
                    </div>
                  </div>
                  <Progress value={skill.proficiency * 20} className="h-1.5" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Interview History */}
      <InterviewHistory consultantId={consultantId} />

      {/* Credly Badges */}
      <CredlyBadgesSection initialUsername={credlyUsername} consultantUserId={userId} />

      {/* Certifications */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Award className="w-4 h-4 text-accent" />
            Certifications
          </CardTitle>
          <Button variant="outline" size="sm" className="text-xs">
            <Upload className="w-3 h-3 me-1" /> Upload New
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {certifications.map((cert, i) => (
            <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-muted/20 border border-border/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{cert.name}</p>
                  <p className="text-xs text-muted-foreground">{cert.issuer} · Issued {cert.issue_date ? new Date(cert.issue_date).toLocaleDateString() : 'N/A'}</p>
                </div>
              </div>
              {cert.verified ? (
                <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                  <CheckCircle className="w-3 h-3 me-1" /> Verified
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] bg-yellow-100 text-yellow-700">
                  <Clock className="w-3 h-3 me-1" /> Pending
                </Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
