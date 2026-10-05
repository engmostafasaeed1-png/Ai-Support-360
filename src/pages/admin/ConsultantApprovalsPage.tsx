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
import { ChevronDown, ChevronUp, Globe, DollarSign, Brain, Users, RotateCcw } from 'lucide-react';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { pendingConsultants } from '@/data/adminMockData';
import { toast } from 'sonner';
import ReinterviewDialog from '@/components/consultant/ReinterviewDialog';
import ScheduleLiveInterviewDialog from '@/components/admin/ScheduleLiveInterviewDialog';
import InterviewHistory from '@/components/consultant/InterviewHistory';
import ConsultantVerificationAuditLog from '@/components/admin/ConsultantVerificationAuditLog';
import ConsultantTrustPanel from '@/components/admin/ConsultantTrustPanel';
import CertificateReview from '@/components/admin/CertificateReview';
import { ApproveWithItemsDialog, AdminVerificationItemsPanel, OverdueItemsBanner } from '@/components/admin/PendingVerificationItems';
import { placeLabel } from '@/lib/geo';
import {
  STATE_LABELS, STATE_TONES, STATUS_FILTERS, countByStatus, countForFilter, decisionOptions, isVerificationState,
  type DecisionOption, type VerificationState,
} from '@/lib/consultantReview';

export default function ConsultantApprovalsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterKey, setFilterKey] = useState(STATUS_FILTERS[0].key);
  const [reinterviewTarget, setReinterviewTarget] = useState<{ id: string; name: string } | null>(null);
  const [liveTarget, setLiveTarget] = useState<{ id: string; userId: string; name: string } | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<{ id: string; name: string; option: DecisionOption } | null>(null);
  const [conditionalTarget, setConditionalTarget] = useState<{ id: string; name: string } | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  const filter = STATUS_FILTERS.find(f => f.key === filterKey) || STATUS_FILTERS[0];

  const { data: consultants, isLoading, isError, error: loadError, refetch } = useQuery({
    queryKey: ['pending-consultants', filter.key],
    queryFn: async () => {
      // consultants and profiles are only linked through auth.users (there is no foreign key between them),
      // so PostgREST cannot embed profiles inside consultants (that request failed with HTTP 400 and the page
      // silently showed "No pending approvals"). Read the consultants first, then their names in a second query.
      const { data, error: consultantsError } = await supabase
        .from('consultants')
        .select(`
          id, user_id, bio, hourly_rate, currency, languages, industries, ai_skills_score, created_at, verification_status,
          city, country, linkedin_url, linkedin_checked_at, credly_username, credly_checked_at, github_url, personal_website,
          consultant_skills (sap_module, proficiency_level),
          certifications (id, name, issuer, issue_date, expiry_date, document_url, verified)
        `)
        .in('verification_status', filter.statuses)
        .order('created_at', { ascending: false });
      if (consultantsError) throw consultantsError;

      const rows = data || [];
      const userIds = rows.map((c: any) => c.user_id).filter(Boolean);
      const nameByUser = new Map<string, string | null>();
      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('user_id, display_name')
          .in('user_id', userIds);
        if (profilesError) throw profilesError;
        (profiles || []).forEach((p: any) => nameByUser.set(p.user_id, p.display_name));
      }

      return rows.map((c: any) => ({
        id: c.id,
        user_id: c.user_id,
        name: nameByUser.get(c.user_id) || 'Unknown',
        status: c.verification_status || 'pending',
        bio: c.bio || '',
        modules: (c.consultant_skills || []).map((s: any) => s.sap_module),
        certificates: c.certifications || [],
        languages: c.languages || [],
        hourlyRate: c.hourly_rate || 0,
        aiScore: c.ai_skills_score || 0,
        appliedAt: new Date(c.created_at).toLocaleDateString(),
        experience: 0,
        city: c.city,
        country: c.country,
        place: placeLabel(c.city, c.country),
        linkedin_url: c.linkedin_url,
        linkedin_checked_at: c.linkedin_checked_at,
        credly_username: c.credly_username,
        credly_checked_at: c.credly_checked_at,
        github_url: c.github_url,
        personal_website: c.personal_website,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? (pendingConsultants as any) : undefined,
  });

  // How many consultants there are in every group (the tabs show these numbers).
  const { data: statusRows } = useQuery({
    queryKey: ['pending-consultants', 'counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('consultants').select('verification_status');
      if (error) throw error;
      return data || [];
    },
    enabled: !isGuest,
  });
  const counts = countByStatus(statusRows || []);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: string; reason?: string; done: string }) => {
      const { error } = await supabase
        .from('consultants')
        .update({ verification_status: status as any })
        .eq('id', id);
      if (error) throw error;

      // Attach the reviewer's reason to the audit row the trigger just created.
      if (reason && reason.trim()) {
        const { data: latest } = await supabase
          .from('consultant_verification_audit')
          .select('id')
          .eq('consultant_id', id)
          .eq('new_status', status as any)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latest?.id) {
          await supabase
            .from('consultant_verification_audit')
            .update({ reason: reason.trim() })
            .eq('id', latest.id);
        }
      }
    },
    onSuccess: (_, { id, done }) => {
      queryClient.invalidateQueries({ queryKey: ['pending-consultants'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['realtime-consultants'] });
      queryClient.invalidateQueries({ queryKey: ['consultant-verification-audit', id] });
      toast.success(done);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Could not save the decision.');
    },
  });

  const openDecision = (id: string, name: string, option: DecisionOption) => {
    setDecisionTarget({ id, name, option });
    setDecisionReason('');
  };

  const submitDecision = async () => {
    if (!decisionTarget) return;
    try {
      await updateStatus.mutateAsync({
        id: decisionTarget.id,
        status: decisionTarget.option.to,
        reason: decisionReason,
        done: decisionTarget.option.done,
      });
      setDecisionTarget(null);
      setDecisionReason('');
    } catch {
      // The error toast is shown by the mutation's onError; keep the dialog open so the reviewer can retry.
    }
  };

  // A link or a certificate was checked: read the list again.
  const refreshList = () => {
    queryClient.invalidateQueries({ queryKey: ['pending-consultants'] });
    queryClient.invalidateQueries({ queryKey: ['realtime-consultants'] });
  };

  const list = consultants || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('approvals_page.title')}</h1>
        <p className="text-sm text-muted-foreground">{isError ? '' : `${list.length} ${filter.label.toLowerCase()}`}</p>
      </div>

      {!isGuest && <OverdueItemsBanner />}
      <ApproveWithItemsDialog target={conditionalTarget} onClose={() => setConditionalTarget(null)} onDone={refreshList} />


      <div className="flex flex-wrap gap-2" role="group" aria-label="Consultant status">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            aria-pressed={f.key === filter.key}
            onClick={() => { setFilterKey(f.key); setExpanded(null); }}
            className={`rounded-xl px-3 py-1.5 text-xs md:text-sm font-medium transition-all ${f.key === filter.key ? 'bg-primary/10 text-primary border border-primary/20' : 'bg-muted/50 text-muted-foreground hover:bg-muted'}`}
          >
            {f.label}{statusRows ? ` (${countForFilter(counts, f)})` : ''}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : isError ? (
        <Card className="border-destructive/30">
          <CardContent className="py-10 text-center space-y-3">
            <p className="text-sm font-medium text-destructive">Could not load consultant applications.</p>
            <p className="text-xs text-muted-foreground">{(loadError as Error)?.message}</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </CardContent>
        </Card>
      ) : list.length === 0 ? (
        <Card className="border-border/50">
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">{filter.key === 'review' ? 'No pending approvals.' : `No consultants are ${filter.label.toLowerCase()}.`}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((c: any) => {
            const isExpanded = expanded === c.id;
            const status: VerificationState = isVerificationState(c.status) ? c.status : 'pending';
            const certificates = c.certificates || (c.certifications || []).map((name: string, i: number) => ({ id: `demo-${i}`, name }));
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
                      {c.place && <p className="text-xs text-muted-foreground">{c.place}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-center hidden sm:block">
                        <div className="flex items-center gap-1">
                          <Brain className="w-3.5 h-3.5 text-accent" />
                          <span className="text-sm font-bold text-foreground">{c.aiScore}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{t('approvals_page.ai_score')}</p>
                      </div>
                      <Badge variant="outline" className={`${STATE_TONES[status]} text-[10px]`}>{STATE_LABELS[status]}</Badge>
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
                        <div className="flex gap-4 content-start">
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

                      <AdminVerificationItemsPanel consultantId={c.id} readOnly={isGuest} />

                      <div className="mb-4">
                        <ConsultantTrustPanel
                          consultant={{
                            id: c.id,
                            city: c.city,
                            country: c.country,
                            linkedin_url: c.linkedin_url,
                            linkedin_checked_at: c.linkedin_checked_at,
                            credly_username: c.credly_username,
                            credly_checked_at: c.credly_checked_at,
                            github_url: c.github_url,
                            personal_website: c.personal_website,
                          }}
                          readOnly={isGuest}
                          onChanged={refreshList}
                        />
                      </div>

                      <div className="mb-4">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">{t('approvals_page.certifications')}</h4>
                        <CertificateReview certificates={certificates} readOnly={isGuest} onChanged={refreshList} />
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

                      <div className="mt-4 pt-4 border-t border-border/50">
                        <ConsultantVerificationAuditLog consultantId={c.id} />
                      </div>

                      <div className="flex items-center gap-3 justify-end flex-wrap mt-4">
                        <span className="text-xs text-muted-foreground me-auto">{t('approvals_page.applied')}: {c.appliedAt}</span>
                        <Button variant="outline" size="sm" onClick={() => setReinterviewTarget({ id: c.id, name: c.name })}>
                          <RotateCcw className="w-3.5 h-3.5 me-1" /> {t('interview.reinterview', 'Re-Interview')}
                        </Button>
                        {!isGuest && c.user_id && (
                          <Button variant="outline" size="sm" onClick={() => setLiveTarget({ id: c.id, userId: c.user_id, name: c.name })}>
                            <Users className="w-3.5 h-3.5 me-1" /> Live interview
                          </Button>
                        )}
                        {!isGuest && ['pending', 'under_review', 'on_hold'].includes(status) && (
                          <Button variant="outline" size="sm" onClick={() => setConditionalTarget({ id: c.id, name: c.name })}>
                            Approve with items to verify
                          </Button>
                        )}
                        {decisionOptions(status).map(option => (
                          <Button
                            key={option.label}
                            variant={option.tone === 'primary' ? 'default' : 'outline'}
                            size="sm"
                            className={option.tone === 'danger' ? 'text-destructive hover:bg-destructive/10' : option.tone === 'primary' ? 'gradient-primary border-0' : ''}
                            onClick={() => openDecision(c.id, c.name, option)}
                            disabled={updateStatus.isPending}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={!!decisionTarget} onOpenChange={(open) => !open && setDecisionTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {decisionTarget?.option.title}
            </DialogTitle>
            <DialogDescription>
              {decisionTarget?.name} — add an optional note to record with this decision in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="decision-reason" className="text-sm">Reason / notes (optional)</Label>
            <Textarea
              id="decision-reason"
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value.slice(0, 1000))}
              placeholder={decisionTarget?.option.placeholder}
              className="min-h-[100px]"
              maxLength={1000}
            />
            <p className="text-[11px] text-muted-foreground text-end">{decisionReason.length}/1000</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecisionTarget(null)} disabled={updateStatus.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submitDecision}
              disabled={updateStatus.isPending}
              className={decisionTarget?.option.tone === 'primary' ? 'gradient-primary border-0' : ''}
              variant={decisionTarget?.option.tone === 'danger' ? 'destructive' : 'default'}
            >
              {updateStatus.isPending ? 'Saving...' : decisionTarget?.option.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {liveTarget && (
        <ScheduleLiveInterviewDialog
          open={!!liveTarget}
          onOpenChange={(o) => !o && setLiveTarget(null)}
          consultantId={liveTarget.id}
          consultantUserId={liveTarget.userId}
          consultantName={liveTarget.name}
        />
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
