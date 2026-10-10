import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  ChevronLeft, Video, MessageSquare, Monitor, Clock, User,
  Calendar, FileText, ListChecks, Play, XCircle, Star, ClipboardCheck,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import ShareMenu from '@/components/ShareMenu';
import AnalyzeSessionButton from '@/components/session/AnalyzeSessionButton';
import SessionFeedbackDialog from '@/components/session/SessionFeedbackDialog';
import SessionSurveyDialog from '@/components/session/SessionSurveyDialog';
import RateSessionDialog from '@/components/session/RateSessionDialog';
import MeetingMinutesCard from '@/components/session/MeetingMinutesCard';
import RequestSatisfactionDialog from '@/components/satisfaction/RequestSatisfactionDialog';
import MeetingLinkButton, { detectProvider } from '@/components/session/MeetingLinkButton';
import MediaPermissionsBanner from '@/components/session/MediaPermissionsBanner';
import FramedAppNotice from '@/components/session/FramedAppNotice';
import TroubleshootingLanguageSwitcher from '@/components/session/TroubleshootingLanguageSwitcher';
import { TranslateTroubleshootingProvider } from '@/components/session/TranslateTroubleshootingContext';
import PreJoinChecklist from '@/components/session/PreJoinChecklist';
import MeetingPermissionsNote from '@/components/session/MeetingPermissionsNote';
import ShareAudioGuideNote from '@/components/session/ShareAudioGuideNote';
import MeetingUrlValidationNotice from '@/components/session/MeetingUrlValidationNotice';
import { sessionRoomUrl } from '@/lib/meetingRoom';

const typeIcons = {
  video: Video,
  chat: MessageSquare,
  screen_share: Monitor,
} as const;

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  scheduled: 'default',
  in_progress: 'secondary',
  completed: 'outline',
  cancelled: 'destructive',
};

export default function SessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isCancelling, setIsCancelling] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showSurvey, setShowSurvey] = useState(false);
  const [showCsat, setShowCsat] = useState(false);
  const [showRate, setShowRate] = useState(false);

  const handleCancel = async () => {
    setIsCancelling(true);
    try {
      const { error } = await supabase
        .from('sessions')
        .update({ status: 'cancelled' })
        .eq('id', sessionId!);
      if (error) throw error;
      toast.success(t('session_detail.cancelled_success'));
      queryClient.invalidateQueries({ queryKey: ['session-detail', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['client-sessions'] });
    } catch (err: any) {
      toast.error(t('session_detail.cancel_error'), { description: err.message });
    } finally {
      setIsCancelling(false);
    }
  };

  const { data: session, isLoading } = useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sessions')
        .select('*, consultants!sessions_consultant_id_fkey(id, user_id, hourly_rate, bio)')
        .eq('id', sessionId!)
        .single();

      if (error) throw error;

      // Get consultant display name
      let consultantName = t('session_detail.unknown_consultant');
      if (data.consultants?.user_id) {
        const { data: profile } = await supabase
          .from('profile_directory')
          .select('display_name, avatar_url')
          .eq('user_id', data.consultants.user_id)
          .single();
        if (profile?.display_name) consultantName = profile.display_name;
      }

      return { ...data, consultant_name: consultantName };
    },
    enabled: !!sessionId,
  });

  // Fetch chat messages for this session
  const { data: messages } = useQuery({
    queryKey: ['session-messages', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId!)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data || [];
    },
    enabled: !!sessionId,
  });

  // Existing rating for this session (so we can show submitted state)
  const { data: existingRating } = useQuery({
    queryKey: ['session-rating', sessionId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from('ratings')
        .select('id, score, comment, is_anonymous, created_at')
        .eq('session_id', sessionId!)
        .eq('client_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId,
  });

  // Aggregate consultant performance: avg score + recent feedback
  const consultantId = (session as any)?.consultant_id as string | undefined;
  const { data: consultantRatings } = useQuery({
    queryKey: ['consultant-ratings-summary', consultantId],
    enabled: !!consultantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('consultant_reviews')
        .select('id, score, comment, is_anonymous, created_at, communication_score, technical_expertise_score, responsiveness_score')
        .eq('consultant_id', consultantId!)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data || []) as any[];
      const total = rows.length;
      const avg = total
        ? rows.reduce((sum, r) => sum + (r.score || 0), 0) / total
        : 0;
      const avgOf = (key: string) => {
        const vals = rows.map((r) => r[key]).filter((v) => typeof v === 'number' && v > 0);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      const breakdown = {
        communication: avgOf('communication_score'),
        technical: avgOf('technical_expertise_score'),
        responsiveness: avgOf('responsiveness_score'),
      };
      const recent = rows.filter((r) => (r.comment || '').trim().length > 0).slice(0, 3);
      return { avg, total, recent, breakdown };
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t('session_detail.not_found')}</p>
      </div>
    );
  }

  const TypeIcon = typeIcons[session.session_type as keyof typeof typeIcons] || Video;
  const status = session.status || 'scheduled';

  // Resolve the meeting URL once and auto-detect the provider so every
  // sub-component (framed notice, validation, checklist, fallback dialog)
  // shows consistent provider-specific troubleshooting copy.
  const savedMeetingUrl = (session as any).meeting_url as string | null | undefined;
  const jitsiFallbackUrl = sessionRoomUrl(sessionId ?? '');
  const meetingUrl = savedMeetingUrl || jitsiFallbackUrl;
  const meetingProvider = detectProvider(meetingUrl);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/client/sessions')} className="gap-1">
        <ChevronLeft className="w-4 h-4" /> {t('session_detail.back')}
      </Button>

      {session.session_type === 'video' && status !== 'completed' && status !== 'cancelled' && (
        <TranslateTroubleshootingProvider>
          <TroubleshootingLanguageSwitcher sessionId={sessionId} />
          <FramedAppNotice
            dismissKey={`framed-notice-dismissed:${sessionId}`}
            meetingUrl={meetingUrl}
            provider={meetingProvider}
            sessionId={sessionId}
          />
          <MeetingUrlValidationNotice url={meetingUrl} sessionId={sessionId} />
          <MediaPermissionsBanner dismissKey={`media-perms-dismissed:${sessionId}`} />
          <MeetingPermissionsNote dismissKey={`perm-note-dismissed:${sessionId}`} />
          <ShareAudioGuideNote dismissKey={`share-audio-note-dismissed:${sessionId}`} />
          <PreJoinChecklist url={meetingUrl} sessionId={sessionId} />
        </TranslateTroubleshootingProvider>
      )}

      {/* Header card */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <TypeIcon className="w-6 h-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={statusVariant[status] || 'outline'} className="text-xs">
                    {t(`sessions_page.status_${status}`)}
                  </Badge>
                <span className="text-sm text-muted-foreground capitalize">
                    {session.session_type?.replace('_', ' ')}
                    {(session as any).video_platform && session.session_type === 'video' && (
                      <span className="ml-1 text-xs text-accent">({(session as any).video_platform})</span>
                    )}
                  </span>
                </div>
                <p className="text-lg font-semibold text-foreground mt-1 flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  {(session as any).consultant_name}
                </p>
                {consultantRatings && consultantRatings.total > 0 ? (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <div className="inline-flex items-center gap-1 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200/70 dark:border-yellow-900/40 px-2 py-1">
                      <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" />
                      <span className="text-xs font-semibold text-foreground">
                        {consultantRatings.avg.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">/ 5</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {consultantRatings.total} {consultantRatings.total === 1 ? 'rating' : 'ratings'}
                    </span>
                    {(['communication', 'technical', 'responsiveness'] as const).map((k) => {
                      const v = consultantRatings.breakdown?.[k];
                      if (typeof v !== 'number') return null;
                      const label = k === 'communication' ? 'Comm' : k === 'technical' ? 'Tech' : 'Resp';
                      return (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1 rounded-md bg-muted/50 border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          title={`${k.charAt(0).toUpperCase() + k.slice(1)} avg`}
                        >
                          <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                          <span className="font-semibold text-foreground">{v.toFixed(1)}</span>
                          <span className="uppercase tracking-wide">{label}</span>
                        </span>
                      );
                    })}
                  </div>
                ) : consultantRatings && consultantRatings.total === 0 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground italic">
                    No ratings yet for this consultant.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <ShareMenu
                title={`Session with ${(session as any).consultant_name}`}
                text={`${session.session_type?.replace('_', ' ')} session`}
                details={[
                  { label: 'Status', value: t(`sessions_page.status_${status}`) },
                  { label: 'Type', value: session.session_type?.replace('_', ' ') || '—' },
                  { label: 'Duration', value: `${session.duration_minutes || 0} min` },
                  { label: 'Scheduled', value: session.scheduled_at ? format(new Date(session.scheduled_at), 'PPp') : '—' },
                ]}
                variant="outline"
                size="sm"
              />
              <AnalyzeSessionButton sessionId={sessionId!} />
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowFeedback(true)}>
                <Star className="w-3.5 h-3.5" /> Feedback
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowSurvey(true)}>
                <ClipboardCheck className="w-3.5 h-3.5" /> Survey
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowCsat(true)}>
                <ClipboardCheck className="w-3.5 h-3.5" /> CSAT
              </Button>
            {status === 'scheduled' && (
              <div className="flex items-center gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="lg" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10">
                      <XCircle className="w-4 h-4" /> {t('session_detail.cancel_session')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="rounded-2xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('session_detail.cancel_confirm_title')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('session_detail.cancel_confirm_desc')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('session_detail.cancel_no')}</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={handleCancel}
                      >
                        {t('session_detail.cancel_yes')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <MeetingLinkButton
                  url={savedMeetingUrl ?? ''}
                  fallbackUrl={jitsiFallbackUrl}
                  fallbackRoomId={sessionId}
                  sessionId={sessionId}
                  provider={meetingProvider}
                />

              </div>
            )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent feedback for the consultant */}
      {consultantRatings && consultantRatings.recent.length > 0 && (
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
              Recent feedback for {(session as any).consultant_name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {consultantRatings.recent.map((r) => (
              <div key={r.id} className="rounded-xl border border-border/50 p-3 bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((v) => (
                      <Star
                        key={v}
                        className={`w-3.5 h-3.5 ${
                          v <= (r.score || 0)
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-muted-foreground/30'
                        }`}
                      />
                    ))}
                    <span className="ms-1.5 text-[11px] text-muted-foreground">
                      {r.is_anonymous ? 'Anonymous' : 'Verified client'}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(r.created_at), 'MMM d, yyyy')}
                  </span>
                </div>
                {r.comment && (
                  <p className="text-xs text-foreground mt-2 leading-relaxed line-clamp-3">
                    "{r.comment}"
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Rate consultant CTA — visible after a completed session */}
      {status === 'completed' && session.consultant_id && (
        <Card className="rounded-2xl border-border/50 bg-gradient-to-br from-primary/5 to-accent/5">
          <CardContent className="p-5">
            {existingRating ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Thanks for your feedback!</p>
                    <div className="flex items-center gap-1 mt-1">
                      {[1, 2, 3, 4, 5].map((v) => (
                        <Star
                          key={v}
                          className={`w-4 h-4 ${
                            v <= existingRating.score
                              ? 'fill-yellow-400 text-yellow-400'
                              : 'text-muted-foreground/30'
                          }`}
                        />
                      ))}
                      <span className="ms-1 text-xs text-muted-foreground">
                        {existingRating.score}/5
                      </span>
                    </div>
                    {existingRating.comment && (
                      <p className="text-xs text-muted-foreground mt-1.5 italic line-clamp-2">
                        "{existingRating.comment}"
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Star className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Rate this session</p>
                    <p className="text-xs text-muted-foreground">
                      Share your experience with {(session as any).consultant_name || 'your consultant'} —
                      it only takes a minute.
                    </p>
                  </div>
                </div>
                <Button onClick={() => setShowRate(true)} className="gap-1.5 shrink-0">
                  <Star className="w-4 h-4" /> Rate &amp; Review
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Details grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Calendar className="w-4 h-4 text-accent" /> {t('session_detail.schedule')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('session_detail.scheduled_at')}</span>
              <span className="font-medium text-foreground">
                {session.scheduled_at ? format(new Date(session.scheduled_at), 'PPp') : '—'}
              </span>
            </div>
            {session.started_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('session_detail.started_at')}</span>
                <span className="font-medium text-foreground">
                  {format(new Date(session.started_at), 'PPp')}
                </span>
              </div>
            )}
            {session.ended_at && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('session_detail.ended_at')}</span>
                <span className="font-medium text-foreground">
                  {format(new Date(session.ended_at), 'PPp')}
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('session_detail.duration')}</span>
              <span className="font-medium text-foreground">
                {session.duration_minutes || 0} {t('session_detail.minutes')}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="w-4 h-4 text-accent" /> {t('session_detail.notes_title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {session.notes ? (
              <p className="text-sm text-muted-foreground leading-relaxed">{session.notes}</p>
            ) : (
              <p className="text-sm text-muted-foreground italic">{t('session_detail.no_notes')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Meeting Minutes (AI-generated MoM) */}
      <MeetingMinutesCard
        sessionId={sessionId!}
        aiSummary={session.ai_summary}
        aiActionItems={session.ai_action_items}
      />

      {/* Chat history */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-accent" /> {t('session_detail.chat_history')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(!messages || messages.length === 0) ? (
            <p className="text-sm text-muted-foreground italic text-center py-8">
              {t('session_detail.no_messages')}
            </p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {messages.map((msg) => {
                const isClient = msg.sender_id === session.client_id;
                return (
                  <div key={msg.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] p-3 rounded-xl text-sm ${
                      isClient
                        ? 'bg-primary text-primary-foreground rounded-ee-sm'
                        : 'bg-muted text-foreground rounded-es-sm'
                    }`}>
                      {msg.content && <p>{msg.content}</p>}
                      {msg.file_name && (
                        <p className="text-xs underline mt-1">{msg.file_name}</p>
                      )}
                      <p className={`text-[10px] mt-1 ${isClient ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                        {format(new Date(msg.created_at), 'p')}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <SessionFeedbackDialog sessionId={sessionId || null} open={showFeedback} onOpenChange={setShowFeedback} />
      <SessionSurveyDialog sessionId={sessionId || null} open={showSurvey} onOpenChange={setShowSurvey} />
      {sessionId && session.consultant_id && (
        <RateSessionDialog
          sessionId={sessionId}
          consultantId={session.consultant_id}
          consultantName={(session as any).consultant_name}
          open={showRate}
          onOpenChange={setShowRate}
        />
      )}
      {showCsat && session?.consultants && (
        <RequestSatisfactionDialog
          open={showCsat}
          onOpenChange={setShowCsat}
          isPending={false}
          parties={[
            { id: session.consultants.user_id, name: (session as any).consultant_name || 'Consultant', role: 'consultant' },
          ]}
          onRequest={async (targetUserId, role) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            const { error: surveyError } = await (supabase.from('satisfaction_surveys') as any).insert({
              rated_by: targetUserId,
              rated_user: user.id,
              role,
              session_id: sessionId,
              requested_by: user.id,
              status: 'pending',
            });
            if (surveyError) { toast.error(surveyError.message || 'The survey could not be requested'); return; }
            toast.success('CSAT survey requested!');
            setShowCsat(false);
          }}
        />
      )}
    </div>
  );
}
