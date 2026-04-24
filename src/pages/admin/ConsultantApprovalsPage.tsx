import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Check, X, ChevronDown, ChevronUp, Award, Globe, DollarSign, Brain, Users, RotateCcw } from 'lucide-react';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { pendingConsultants } from '@/data/adminMockData';
import { toast } from 'sonner';
import ReinterviewDialog from '@/components/consultant/ReinterviewDialog';
import InterviewHistory from '@/components/consultant/InterviewHistory';
import ConsultantVerificationAuditLog from '@/components/admin/ConsultantVerificationAuditLog';

export default function ConsultantApprovalsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reinterviewTarget, setReinterviewTarget] = useState<{ id: string; name: string } | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{ id: string; name: string; status: string } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  const { data: consultants, isLoading } = useQuery({
    queryKey: ['pending-consultants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultants')
        .select(`
          id, user_id, bio, hourly_rate, currency, languages, industries, ai_skills_score, created_at,
          profiles:user_id (display_name, avatar_url),
          consultant_skills (sap_module, proficiency_level),
          certifications (name, issuer)
        `)
        .in('verification_status', ['pending', 'under_review'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((c: any) => ({
        id: c.id,
        user_id: c.user_id,
        name: c.profiles?.display_name || 'Unknown',
        bio: c.bio || '',
        modules: (c.consultant_skills || []).map((s: any) => s.sap_module),
        certifications: (c.certifications || []).map((cert: any) => cert.name),
        languages: c.languages || [],
        hourlyRate: c.hourly_rate || 0,
        aiScore: c.ai_skills_score || 0,
        appliedAt: new Date(c.created_at).toLocaleDateString(),
        experience: 0,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? (pendingConsultants as any) : undefined,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('consultants')
        .update({ verification_status: status as any })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['pending-consultants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success(status === 'verified' ? 'Consultant approved!' : 'Consultant rejected.');
    },
  });

  const list = consultants || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('approvals_page.title')}</h1>
        <p className="text-sm text-muted-foreground">{list.length} {t('approvals_page.subtitle')}</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : list.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No pending approvals.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((c: any) => {
            const isExpanded = expanded === c.id;
            return (
              <Card key={c.id} className="border-border/50">
                <CardContent className="p-0">
                  <div className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setExpanded(isExpanded ? null : c.id)}>
                    <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-sm font-bold text-primary-foreground shrink-0">
                      {c.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.modules.join(' · ')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-center hidden sm:block">
                        <div className="flex items-center gap-1">
                          <Brain className="w-3.5 h-3.5 text-accent" />
                          <span className="text-sm font-bold text-foreground">{c.aiScore}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{t('approvals_page.ai_score')}</p>
                      </div>
                      <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-[10px]">{t('approvals_page.pending')}</Badge>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border/50 p-4 bg-muted/10">
                      <div className="grid sm:grid-cols-2 gap-4 mb-4">
                        <div>
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">{t('approvals_page.bio')}</h4>
                          <p className="text-sm text-foreground">{c.bio || 'No bio provided.'}</p>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">{t('approvals_page.certifications')}</h4>
                            <div className="space-y-1">
                              {c.certifications.length > 0 ? c.certifications.map((cert: string) => (
                                <div key={cert} className="flex items-center gap-1.5 text-sm text-foreground">
                                  <Award className="w-3.5 h-3.5 text-accent shrink-0" />
                                  {cert}
                                </div>
                              )) : <p className="text-xs text-muted-foreground">None</p>}
                            </div>
                          </div>
                          <div className="flex gap-4">
                            <div className="flex items-center gap-1.5 text-sm">
                              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                              {c.languages.join(', ') || 'N/A'}
                            </div>
                            <div className="flex items-center gap-1.5 text-sm">
                              <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                              ${c.hourlyRate}/hr
                            </div>
                          </div>
                        </div>
                      </div>

                      {c.modules.length > 0 && (
                        <div className="flex items-center gap-2 mb-4">
                          <span className="text-xs text-muted-foreground">SAP Modules:</span>
                          {c.modules.map((m: string) => (
                            <Badge key={m} variant="secondary" className="text-[10px]">{m}</Badge>
                          ))}
                        </div>
                      )}

                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-muted-foreground">{t('approvals_page.ai_skills_assessment')}</span>
                          <span className="text-xs font-bold text-foreground">{c.aiScore}/100</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full gradient-primary transition-all" style={{ width: `${c.aiScore}%` }} />
                        </div>
                      </div>

                      <InterviewHistory consultantId={c.id} />

                      <div className="flex items-center gap-3 justify-end flex-wrap mt-4">
                        <span className="text-xs text-muted-foreground me-auto">{t('approvals_page.applied')}: {c.appliedAt}</span>
                        <Button variant="outline" size="sm" onClick={() => setReinterviewTarget({ id: c.id, name: c.name })}>
                          <RotateCcw className="w-3.5 h-3.5 me-1" /> {t('interview.reinterview', 'Re-Interview')}
                        </Button>
                        <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => updateStatus.mutate({ id: c.id, status: 'rejected' })} disabled={updateStatus.isPending}>
                          <X className="w-3.5 h-3.5 me-1" /> {t('approvals_page.reject')}
                        </Button>
                        <Button size="sm" className="gradient-primary border-0" onClick={() => updateStatus.mutate({ id: c.id, status: 'verified' })} disabled={updateStatus.isPending}>
                          <Check className="w-3.5 h-3.5 me-1" /> {t('approvals_page.approve')}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {reinterviewTarget && (
        <ReinterviewDialog
          open={!!reinterviewTarget}
          onOpenChange={(open) => !open && setReinterviewTarget(null)}
          consultantId={reinterviewTarget.id}
          consultantName={reinterviewTarget.name}
        />
      )}
    </div>
  );
}
