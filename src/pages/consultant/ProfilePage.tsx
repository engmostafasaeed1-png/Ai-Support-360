import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { User, Globe, Clock, DollarSign, Save, RotateCcw, Loader2, Brain } from 'lucide-react';
import InterviewTranscript from '@/components/consultant/InterviewTranscript';
import AvatarUpload from '@/components/profile/AvatarUpload';
import ReinterviewDialog from '@/components/consultant/ReinterviewDialog';
import ConsultantLinksCard from '@/components/consultant/ConsultantLinksCard';
import AvailabilityToggle from '@/components/consultant/AvailabilityToggle';
import { useConsultantProfile } from '@/hooks/useConsultantProfile';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

export default function ProfilePage() {
  const { t } = useTranslation();
  const { data: profile, isLoading } = useConsultantProfile();
  const queryClient = useQueryClient();
  const [reinterviewOpen, setReinterviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    displayName: '',
    bio: '',
    hourlyRate: 0,
    currency: 'USD',
    timezone: 'Asia/Riyadh',
    languages: [] as string[],
  });

  useEffect(() => {
    if (profile) {
      setForm({
        displayName: profile.display_name || '',
        bio: profile.bio || '',
        hourlyRate: profile.hourly_rate || 0,
        currency: profile.currency || 'USD',
        timezone: profile.timezone || 'Asia/Riyadh',
        languages: profile.languages || ['en'],
      });
    }
  }, [profile]);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await supabase.from('profiles').update({
        display_name: form.displayName,
      }).eq('user_id', profile.user_id);

      await supabase.from('consultants').update({
        bio: form.bio,
        hourly_rate: form.hourlyRate,
        currency: form.currency,
        timezone: form.timezone,
        languages: form.languages,
      }).eq('user_id', profile.user_id);

      queryClient.invalidateQueries({ queryKey: ['consultant-profile'] });
      toast.success('Profile updated successfully');
    } catch (err) {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid lg:grid-cols-3 gap-6">
          <Skeleton className="h-80" />
          <Skeleton className="h-80 lg:col-span-2" />
        </div>
      </div>
    );
  }

  const p: any = profile || { display_name: '', bio: '', hourly_rate: 0, currency: 'USD', timezone: 'Asia/Riyadh', languages: ['en'], rating: 0, total_reviews: 0, response_time_minutes: 0, verification_status: 'pending', availability_status: 'offline', ai_skills_score: 0, credibility_credits: 0, ai_interview_badge: null, ai_interview_completed_at: null };
  const badgeStyles: Record<string, { bg: string; text: string; ring: string; emoji: string }> = {
    Gold:     { bg: 'from-amber-300 via-yellow-400 to-amber-500', text: 'text-amber-900',   ring: 'ring-amber-400/50', emoji: '🥇' },
    Silver:   { bg: 'from-slate-200 via-slate-300 to-slate-400',  text: 'text-slate-800',   ring: 'ring-slate-400/50', emoji: '🥈' },
    Bronze:   { bg: 'from-orange-300 via-orange-400 to-orange-600', text: 'text-orange-950', ring: 'ring-orange-500/50', emoji: '🥉' },
    Verified: { bg: 'from-emerald-300 via-emerald-400 to-emerald-600', text: 'text-emerald-950', ring: 'ring-emerald-500/50', emoji: '✅' },
  };
  const badgeStyle = p.ai_interview_badge ? badgeStyles[p.ai_interview_badge] : null;

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Profile Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Keep your profile up to date to attract more clients.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AvailabilityToggle variant="pill" />
          <Button variant="outline" size="sm" onClick={() => setReinterviewOpen(true)}>
            <RotateCcw className="w-4 h-4 me-1" /> {t('interview.request_reinterview', 'Request Re-Interview')}
          </Button>
          <Button className="gradient-primary border-0" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Save className="w-4 h-4 me-1" />}
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-6 text-center">
            <AvatarUpload />
            <h3 className="text-lg font-bold text-foreground">{form.displayName}</h3>
            <p className="text-sm text-muted-foreground mt-1">SAP Consultant</p>
            <div className="flex items-center justify-center gap-2 mt-3">
              {p.verification_status === 'verified' && (
                <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">Verified</Badge>
              )}
              {(p.rating || 0) >= 4.5 && (
                <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 text-xs">Top Rated</Badge>
              )}
              {p.ai_interview_badge && badgeStyle && (
                <Badge className={`bg-gradient-to-r ${badgeStyle.bg} ${badgeStyle.text} text-xs border-0 ring-1 ${badgeStyle.ring} shadow-sm`}>
                  {badgeStyle.emoji} AI Interview · {p.ai_interview_badge}
                </Badge>
              )}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-xl bg-muted/50">
                <div className="text-lg font-bold text-foreground">{p.rating || 0}</div>
                <div className="text-[10px] text-muted-foreground">Rating</div>
              </div>
              <div className="p-2 rounded-xl bg-muted/50">
                <div className="text-lg font-bold text-foreground">{p.total_reviews || 0}</div>
                <div className="text-[10px] text-muted-foreground">Reviews</div>
              </div>
              <div className="p-2 rounded-xl bg-muted/50">
                <div className="text-lg font-bold text-foreground">{p.response_time_minutes || 0}m</div>
                <div className="text-[10px] text-muted-foreground">Avg Response</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Profile Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                  <User className="w-3.5 h-3.5" /> Display Name
                </label>
                <Input
                  value={form.displayName}
                  onChange={(e) => setForm(f => ({ ...f, displayName: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" /> Hourly Rate ({form.currency})
                </label>
                <Input
                  type="number"
                  value={form.hourlyRate}
                  onChange={(e) => setForm(f => ({ ...f, hourlyRate: Number(e.target.value) }))}
                  className="rounded-xl"
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Bio</label>
              <Textarea
                value={form.bio}
                onChange={(e) => setForm(f => ({ ...f, bio: e.target.value }))}
                rows={4}
                className="rounded-xl"
                placeholder="Tell clients about your expertise..."
              />
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Timezone
                </label>
                <Input
                  value={form.timezone}
                  onChange={(e) => setForm(f => ({ ...f, timezone: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" /> Languages
                </label>
                <Input
                  value={form.languages.join(', ')}
                  onChange={(e) => setForm(f => ({ ...f, languages: e.target.value.split(',').map(l => l.trim()).filter(Boolean) }))}
                  className="rounded-xl"
                  placeholder="en, ar, fr"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConsultantLinksCard />

      {/* AI Skills Score + Credibility Credits */}
      {(p.ai_skills_score || 0) > 0 || (p.credibility_credits || 0) > 0 ? (
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-6">
            <div className="grid md:grid-cols-3 gap-4">
              {/* Score */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center shrink-0">
                  <span className="text-2xl font-bold text-accent">{p.ai_skills_score || 0}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">AI Skills Score</h3>
                  <p className="text-xs text-muted-foreground">Latest interview evaluation</p>
                </div>
              </div>
              {/* Badge */}
              {p.ai_interview_badge && badgeStyle && (
                <div className="flex items-center gap-4">
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${badgeStyle.bg} flex items-center justify-center shrink-0 shadow-md ring-2 ${badgeStyle.ring}`}>
                    <span className="text-2xl">{badgeStyle.emoji}</span>
                  </div>
                  <div>
                    <h3 className={`font-semibold ${badgeStyle.text}`}>{p.ai_interview_badge} Interviewer</h3>
                    <p className="text-xs text-muted-foreground">Earned {p.ai_interview_completed_at ? new Date(p.ai_interview_completed_at).toLocaleDateString() : ''}</p>
                  </div>
                </div>
              )}
              {/* Credits */}
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0 ring-1 ring-primary/30">
                  <span className="text-2xl font-bold text-primary">{p.credibility_credits || 0}</span>
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Credibility Credits</h3>
                  <p className="text-xs text-muted-foreground">Boost your visibility to clients</p>
                </div>
              </div>
            </div>
            {(p.ai_skills_score || 0) === 0 && (
              <p className="text-xs text-muted-foreground mt-4 text-center">
                💡 Take the optional AI interview to earn a badge + up to 150 credibility credits.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-2xl border-dashed border-primary/30 bg-primary/5">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xl">🎁</span>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">Earn a verified badge + credibility credits</h3>
              <p className="text-xs text-muted-foreground">The AI interview is optional but earns you up to <strong>150 credits</strong> and a Gold badge clients can see.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => window.location.href = '/consultant/interviews'}>
              Take Interview
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Interview History & Transcripts */}
      <div>
        <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" /> Interview History & Results
        </h2>
        <InterviewTranscript consultantId={profile?.id || ''} viewMode="consultant" />
      </div>
    </div>

    <ReinterviewDialog
      open={reinterviewOpen}
      onOpenChange={setReinterviewOpen}
      consultantId={profile?.id || ''}
      consultantName={form.displayName}
    />
    </>
  );
}
