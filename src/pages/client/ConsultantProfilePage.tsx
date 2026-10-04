import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { mockRecommendedConsultants } from '@/data/clientMockData';
import { mockConsultantDetailData } from '@/data/consultantDetailMockData';
import { useGuestMode } from '@/contexts/GuestModeContext';
import {
  Star, MapPin, Clock, Globe, Shield, Award, Video,
  MessageSquare, Monitor, ChevronLeft, CalendarDays, BadgeCheck, ExternalLink, Brain, EyeOff, User,
} from 'lucide-react';
import InterviewTranscript from '@/components/consultant/InterviewTranscript';
import ShareMenu from '@/components/ShareMenu';
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import BookingModal from '@/components/client/BookingModal';
import WriteReviewDialog from '@/components/client/WriteReviewDialog';
import VerificationBadge, { type VerificationStatus } from '@/components/consultant/VerificationBadge';
import LinkStatus from '@/components/consultant/LinkStatus';
import ConsultantLocationMap from '@/components/client/ConsultantLocationMap';
import { STATE_META, availabilityState } from '@/lib/mapMarkers';
import { credlyProfileUrl, linkState, normalizeCredlyUsername, normalizeLinkedinUrl } from '@/lib/consultantLinks';
import { placeLabel } from '@/lib/geo';
import { consultantPoint } from '@/lib/consultantDirectory';
import { useConsultantPresence } from '@/hooks/useConsultantPresence';
import { applyPresence } from '@/lib/presence';

export default function ConsultantProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [credlyBadges, setCredlyBadges] = useState<any[]>([]);
  const [credlyLoading, setCredlyLoading] = useState(false);

  const { isGuest } = useGuestMode();

  // Fetch live reviews for this consultant
  const { data: liveReviews, isLoading: reviewsLoading } = useQuery({
    queryKey: ['consultant-profile-reviews', id],
    queryFn: async () => {
      if (!id) return [];
      const { data: ratings } = await supabase
        .from('consultant_reviews')
        .select('id, score, comment, created_at, client_id, is_anonymous')
        .eq('consultant_id', id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!ratings || ratings.length === 0) return [];

      const nonAnonIds = ratings.filter((r: any) => !r.is_anonymous && r.client_id).map((r: any) => r.client_id);
      let clientMap: Record<string, string> = {};
      if (nonAnonIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profile_directory')
          .select('user_id, display_name')
          .in('user_id', nonAnonIds);
        if (profiles) {
          clientMap = Object.fromEntries(profiles.map(p => [p.user_id, p.display_name || 'Client']));
        }
      }

      return ratings.map((r: any) => ({
        ...r,
        client_name: r.is_anonymous ? null : (clientMap[r.client_id] || 'Client'),
        avatar: r.is_anonymous ? '?' : (clientMap[r.client_id]?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'CL'),
      }));
    },
  });

  // Fetch live consultant profile + detail (bio, skills, certifications) for signed-in users
  const { data: liveProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['consultant-profile-detail', id],
    queryFn: async () => {
      if (!id) return null;
      const { data: c } = await supabase
        .from('consultants')
        .select('id, user_id, bio, hourly_rate, currency, languages, industries, response_time_minutes, credly_username, availability_status, rating, total_reviews, verification_status, ai_skills_score, city, country, latitude, longitude, linkedin_url, linkedin_checked_at, credly_checked_at')
        .eq('id', id)
        .maybeSingle();
      if (!c) return null;

      const { data: profile } = await supabase
        .from('profile_directory')
        .select('display_name, avatar_url')
        .eq('user_id', c.user_id)
        .maybeSingle();

      const { data: skills } = await supabase
        .from('consultant_skills')
        .select('sap_module, proficiency_level, years_experience, certified')
        .eq('consultant_id', id);

      const { data: certs } = await supabase
        .from('certifications_public')
        .select('name, issuer, issue_date, verified')
        .eq('consultant_id', id);

      const name = profile?.display_name || 'Consultant';
      const initials = name.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);

      return {
        consultant: {
          id: c.id,
          name,
          specialty: skills?.[0]?.sap_module || 'SAP',
          rating: Number(c.rating) || 0,
          reviews: c.total_reviews || 0,
          rate: Number(c.hourly_rate) || 0,
          avatar: initials,
          available: c.availability_status === 'available',
          status: availabilityState(c.availability_status),
          badges: c.verification_status === 'verified' ? ['verified'] : [],
          city: placeLabel(c.city, c.country),
          lat: consultantPoint(c)?.lat ?? null,
          lng: consultantPoint(c)?.lng ?? null,
          credly_username: normalizeCredlyUsername(c.credly_username),
          linkedin_url: normalizeLinkedinUrl(c.linkedin_url),
          linkedin_state: linkState(normalizeLinkedinUrl(c.linkedin_url), c.linkedin_checked_at),
          credly_state: linkState(normalizeCredlyUsername(c.credly_username), c.credly_checked_at),
        },
        detail: {
          bio: c.bio || 'No bio provided yet.',
          responseTime: c.response_time_minutes || 0,
          languages: c.languages || [],
          industries: c.industries || [],
          certifications: (certs || []).map((ct: any) => ({
            name: ct.name,
            issuer: ct.issuer || '',
            year: ct.issue_date ? new Date(ct.issue_date).getFullYear().toString() : '',
            verified: !!ct.verified,
          })),
          skills: (skills || []).map((sk: any) => ({
            module: sk.sap_module,
            proficiency: sk.proficiency_level || 0,
            years: sk.years_experience || 0,
            certified: !!sk.certified,
          })),
          availableSlots: [] as { time: string; type: 'video' | 'chat' | 'screen_share'; duration: number }[],
          aiScore: Number((c as any).ai_skills_score) || 0,
          reviews: [] as any[],
        },
      };
    },
    enabled: !isGuest && !!id,
  });

  // Online and Busy are shown only while the consultant's app is open; before the first answer of the presence channel the status that the consultant set is shown.
  const present = useConsultantPresence(!isGuest);
  const storedConsultant: any = isGuest ? mockRecommendedConsultants.find(c => c.id === id) : liveProfile?.consultant;
  const consultant: any = storedConsultant ? applyPresence(storedConsultant, present) : storedConsultant;
  const detail: any = isGuest ? mockConsultantDetailData : (liveProfile?.detail || mockConsultantDetailData);

  // Try to fetch real verification_status; fall back to mock badge
  const { data: liveConsultant } = useQuery({
    queryKey: ['consultant-verification', id],
    queryFn: async () => {
      if (!id) return null;
      const { data } = await supabase
        .from('consultants')
        .select('id, verification_status')
        .eq('id', id)
        .maybeSingle();
      return data;
    },
    enabled: !!id,
  });

  // Realtime: refresh badge when an admin changes the verification status
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`consultant-verification-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'consultants', filter: `id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['consultant-verification', id] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, queryClient]);

  const verificationStatus: VerificationStatus =
    (liveConsultant?.verification_status as VerificationStatus) ||
    (consultant?.badges?.includes('verified') ? 'verified' : 'pending');

  // Fetch Credly badges if consultant has a credly_username
  useEffect(() => {
    if (!consultant?.credly_username) return;
    const fetchCredly = async () => {
      setCredlyLoading(true);
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/credly-badges?username=${encodeURIComponent(consultant.credly_username!)}`,
          { headers: { 'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
        );
        if (res.ok) {
          const data = await res.json();
          setCredlyBadges(data.badges || []);
        }
      } catch (e) {
        console.error('Failed to fetch Credly badges:', e);
      } finally {
        setCredlyLoading(false);
      }
    };
    fetchCredly();
  }, [consultant?.credly_username]);

  if (!isGuest && profileLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (!consultant) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t('consultant_profile.not_found')}</p>
      </div>
    );
  }

  const status = (consultant.status ?? (consultant.available ? 'available' : 'offline')) as 'available' | 'busy' | 'offline';
  const statusColor = STATE_META[status].dot;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
        <ChevronLeft className="w-4 h-4" /> {t('consultant_profile.back')}
      </Button>

      {/* Hero Section */}
      <Card className="rounded-2xl border-border/50 overflow-hidden">
        <div className="h-28 gradient-primary" />
        <CardContent className="relative px-6 pb-6">
          <div className="flex flex-col md:flex-row gap-6 -mt-12">
            {/* Avatar */}
            <div className="relative">
              <div className="w-24 h-24 rounded-2xl gradient-primary flex items-center justify-center text-primary-foreground text-3xl font-bold border-4 border-background shadow-lg">
                {consultant.avatar}
              </div>
              <div className={`absolute -bottom-1 -end-1 w-5 h-5 rounded-full ${statusColor} border-2 border-background`} />
            </div>

            {/* Info */}
            <div className="flex-1 pt-2">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-foreground flex items-center gap-2 flex-wrap">
                    {consultant.name}
                    <VerificationBadge status={verificationStatus} size="md" />
                  </h1>
                  <p className="text-muted-foreground">{consultant.specialty}</p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <div className="flex items-center gap-1 text-sm">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">{consultant.city || 'Location not set'}</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">{detail.responseTime} {t('consultant_profile.min_response')}</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">{detail.languages.join(', ')}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium" data-testid="consultant-status">
                      <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                      {STATE_META[status].label}
                    </span>
                    {consultant.linkedin_url && (
                      <a href={consultant.linkedin_url} target="_blank" rel="noopener noreferrer" aria-label="Open the LinkedIn profile in a new tab">
                        <LinkStatus state={consultant.linkedin_state} label="LinkedIn" />
                      </a>
                    )}
                    {consultant.credly_username && credlyProfileUrl(consultant.credly_username) && (
                      <a href={credlyProfileUrl(consultant.credly_username) as string} target="_blank" rel="noopener noreferrer" aria-label="Open the Credly profile in a new tab">
                        <LinkStatus state={consultant.credly_state} label="Credly" />
                      </a>
                    )}
                    {consultant.badges.map((badge: any) => (
                      <Badge key={badge} variant="secondary" className="text-xs">
                        {t(`consultants.${badge}`)}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Stats + CTA */}
                <div className="flex flex-col items-end gap-3">
                  <ShareMenu
                    title={consultant.name}
                    text={`${consultant.specialty} — ${consultant.rating}★ — $${consultant.rate}/hr`}
                    details={[
                      { label: 'Specialty', value: consultant.specialty },
                      { label: 'Rating', value: `${consultant.rating} (${consultant.reviews} reviews)` },
                      { label: 'Rate', value: `$${consultant.rate}/hr` },
                      { label: 'Location', value: consultant.city },
                    ]}
                    variant="outline"
                    size="sm"
                  />
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                        <span className="text-xl font-bold text-foreground">{consultant.rating}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{consultant.reviews} {t('consultants_page.reviews')}</span>
                    </div>
                    <div className="text-center">
                      <div className="text-xl font-bold text-foreground">${consultant.rate}</div>
                      <span className="text-xs text-muted-foreground">/hr</span>
                    </div>
                  </div>
                  <Button className="gradient-primary border-0 w-full md:w-auto" size="lg" onClick={() => setBookingOpen(true)}>
                    <Video className="w-4 h-4 me-1" /> {t('consultant_profile.book_session')}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="about" className="space-y-4">
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="about" className="rounded-lg text-sm">{t('consultant_profile.about')}</TabsTrigger>
          <TabsTrigger value="skills" className="rounded-lg text-sm">{t('consultant_profile.skills')}</TabsTrigger>
          <TabsTrigger value="availability" className="rounded-lg text-sm">{t('consultant_profile.availability')}</TabsTrigger>
          <TabsTrigger value="reviews" className="rounded-lg text-sm">{t('consultant_profile.reviews')}</TabsTrigger>
        </TabsList>

        {/* About Tab */}
        <TabsContent value="about" className="space-y-6">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">{t('consultant_profile.bio')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground leading-relaxed">{detail.bio}</p>
            </CardContent>
          </Card>

          {consultant.lat != null && consultant.lng != null && (
            <ConsultantLocationMap lat={consultant.lat} lng={consultant.lng} place={consultant.city || ''} />
          )}

          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Award className="w-4 h-4 text-accent" /> {t('consultant_profile.certifications')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {/* Manual certifications */}
                {detail.certifications.map((cert: any, i: number) => (
                  <div key={`manual-${i}`} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 border border-border/30">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                        <BadgeCheck className="w-5 h-5 text-accent" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{cert.name}</p>
                        <p className="text-xs text-muted-foreground">{cert.issuer} • {cert.year}</p>
                      </div>
                    </div>
                    {cert.verified && (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 text-[10px]">
                        <Shield className="w-3 h-3 me-1" /> {t('consultant_profile.verified')}
                      </Badge>
                    )}
                  </div>
                ))}

                {/* Credly badges loading skeleton */}
                {credlyLoading && (
                  <>
                    {[1, 2].map(i => (
                      <div key={`skel-${i}`} className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/30">
                        <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {credlyBadges.length > 0 && (
                  <p className="text-[11px] text-muted-foreground" data-testid="credly-note">
                    These badges are read from the Credly profile that the consultant linked{consultant.credly_state === 'checked' ? ', which the platform team has checked.' : '. The platform team has not checked that this profile belongs to the consultant yet.'}
                  </p>
                )}

                {/* Credly synced badges */}
                {credlyBadges.map((badge) => (
                  <a
                    key={`credly-${badge.id}`}
                    href={badge.badge_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 rounded-xl bg-orange-50/50 dark:bg-orange-950/10 border border-orange-200/40 dark:border-orange-800/30 hover:bg-orange-100/50 dark:hover:bg-orange-950/20 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      {badge.image_url ? (
                        <img src={badge.image_url} alt={badge.name} className="w-10 h-10 rounded-xl object-contain shrink-0" />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                          <Award className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-foreground group-hover:text-orange-700 dark:group-hover:text-orange-400 transition-colors">
                          {badge.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {badge.issuer}
                          {badge.issued_at && ` • ${new Date(badge.issued_at).getFullYear()}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {badge.is_active ? (
                        <Badge variant="secondary" className="bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 text-[10px] gap-0.5">
                          <Award className="w-2.5 h-2.5" /> Credly
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
                          {t('credly.expired', 'Expired')}
                        </Badge>
                      )}
                      <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">{t('consultant_profile.industries')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {detail.industries.map((ind: any) => (
                  <Badge key={ind} variant="outline" className="text-xs">{ind}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Skills Tab */}
        <TabsContent value="skills">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">{t('consultant_profile.sap_skills')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {detail.skills.map((skill: any, i: number) => (
                  <div key={i} className="p-4 rounded-xl bg-muted/20 border border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">{skill.module}</span>
                      {skill.certified && (
                        <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">
                          {t('consultant_profile.certified')}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground mb-2">
                      <span>{t('consultant_profile.level')} {skill.proficiency}/5</span>
                      <span>{skill.years} {t('consultant_profile.years_exp')}</span>
                    </div>
                    <Progress value={skill.proficiency * 20} className="h-1.5" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Availability Tab */}
        <TabsContent value="availability" className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="rounded-2xl border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-accent" /> {t('consultant_profile.select_date')}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex justify-center">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => date < new Date()}
                  className="pointer-events-auto"
                />
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">{t('consultant_profile.available_slots')}</CardTitle>
              </CardHeader>
              <CardContent>
                {selectedDate ? (
                  <div className="space-y-2">
                    {detail.availableSlots.map((slot: any, i: number) => (
                      <button
                        key={i}
                        className="w-full flex items-center justify-between p-3 rounded-xl border border-border/50 hover:border-accent/50 hover:bg-accent/5 transition-colors text-start"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          <span className="text-sm font-medium text-foreground">{slot.time}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {slot.type === 'video' && <Video className="w-3.5 h-3.5" />}
                          {slot.type === 'chat' && <MessageSquare className="w-3.5 h-3.5" />}
                          {slot.type === 'screen_share' && <Monitor className="w-3.5 h-3.5" />}
                          <span>{slot.duration} min</span>
                        </div>
                      </button>
                    ))}
                    <Button className="w-full gradient-primary border-0 mt-4" onClick={() => setBookingOpen(true)}>
                      {t('consultant_profile.book_session')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                    {t('consultant_profile.select_date_prompt')}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Session types */}
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">{t('consultant_profile.session_types')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { icon: Video, label: t('consultant_profile.video_call'), desc: t('consultant_profile.video_desc') },
                  { icon: MessageSquare, label: t('consultant_profile.live_chat'), desc: t('consultant_profile.chat_desc') },
                  { icon: Monitor, label: t('consultant_profile.screen_share'), desc: t('consultant_profile.screen_desc') },
                ].map((type, i) => (
                  <div key={i} className="p-4 rounded-xl bg-muted/20 border border-border/30 text-center">
                    <type.icon className="w-8 h-8 text-accent mx-auto mb-2" />
                    <p className="text-sm font-medium text-foreground">{type.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{type.desc}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reviews Tab */}
        <TabsContent value="reviews">
          <Card className="rounded-2xl border-border/50">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-base font-semibold">
                {t('consultant_profile.client_reviews')} ({consultant.reviews})
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => setReviewOpen(true)}>
                <Star className="w-3.5 h-3.5 me-1" /> {t('reviews.write_review', 'Write a Review')}
              </Button>
            </CardHeader>
            <CardContent>
              {/* Rating summary */}
              <div className="flex items-center gap-6 p-4 rounded-xl bg-muted/20 border border-border/30 mb-6">
                <div className="text-center">
                  <div className="text-4xl font-bold text-foreground">{consultant.rating}</div>
                  <div className="flex items-center gap-0.5 mt-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className={`w-4 h-4 ${i < Math.round(consultant.rating) ? 'text-yellow-500 fill-yellow-500' : 'text-muted'}`} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{consultant.reviews} {t('consultants_page.reviews')}</p>
                </div>
                <div className="flex-1 space-y-1.5">
                  {[5, 4, 3, 2, 1].map(star => {
                    const reviews_ = liveReviews && liveReviews.length > 0 ? liveReviews : detail.reviews;
                    const count = reviews_.filter((r: any) => r.score === star).length;
                    const pct = reviews_.length > 0 ? Math.round((count / reviews_.length) * 100) : 0;
                    return (
                      <div key={star} className="flex items-center gap-2 text-xs">
                        <span className="w-4 text-end text-muted-foreground">{star}</span>
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        <Progress value={pct} className="h-1.5 flex-1" />
                        <span className="w-8 text-end text-muted-foreground">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Review list */}
              {(liveReviews && liveReviews.length > 0 ? liveReviews : detail.reviews).length === 0 ? (
                <div className="text-center py-8">
                  <Star className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t('reviews.no_reviews', 'No reviews yet')}</p>
                </div>
              ) : (
              <div className="space-y-4">
                {(liveReviews && liveReviews.length > 0 ? liveReviews : detail.reviews).map((review: any, i: number) => (
                  <div key={review.id || i} className="p-4 rounded-xl border border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-xs font-bold text-foreground">
                          {review.is_anonymous ? (
                            <EyeOff className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            review.avatar || <User className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {review.is_anonymous ? t('reviews.anonymous', 'Anonymous') : (review.client_name || review.client)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {review.created_at ? format(new Date(review.created_at), 'MMM d, yyyy') : review.date}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, j) => (
                          <Star key={j} className={`w-3 h-3 ${j < review.score ? 'text-yellow-500 fill-yellow-500' : 'text-muted'}`} />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{review.comment}</p>
                    {review.module && (
                      <Badge variant="outline" className="text-[10px] mt-2">{review.module}</Badge>
                    )}
                  </div>
                ))}
              </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Profile Credibility Score */}
      <Card className="rounded-2xl border-border/50">
        <CardContent className="p-6">
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Profile Credibility
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Credibility is calculated from certifications, experience, reviews, and AI interview performance.
          </p>

          {/* Credibility breakdown */}
          {(() => {
            const interviewScore = Number(detail.aiScore) || 0;
            const hasInterview = interviewScore > 0;
            
            const certScore = Math.min(detail.certifications.length * 10, 25);
            const expScore = Math.min(detail.skills.reduce((s: any, sk: any) => s + sk.years, 0), 25);
            const reviewScore = Math.min(Math.round(consultant.rating * 5), 25);
            // Interview contributes 20% if completed, based on score (0-100 → 0-20)
            const interviewContrib = hasInterview ? Math.round((interviewScore / 100) * 20) : 0;
            // Remaining 5% for profile completeness
            const profileScore = 5;
            const total = Math.min(certScore + expScore + reviewScore + interviewContrib + profileScore, 100);

            const segments = [
              { label: 'Certifications', value: certScore, max: 25, color: 'bg-blue-500' },
              { label: 'Experience', value: expScore, max: 25, color: 'bg-green-500' },
              { label: 'Client Reviews', value: reviewScore, max: 25, color: 'bg-amber-500' },
              { label: 'AI Interview', value: interviewContrib, max: 20, color: 'bg-purple-500', highlight: true },
              { label: 'Profile Completeness', value: profileScore, max: 5, color: 'bg-muted-foreground/40' },
            ];

            return (
              <div className="space-y-4">
                {/* Total score ring */}
                <div className="flex items-center gap-6">
                  <div className="relative w-20 h-20 shrink-0">
                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                      <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--primary))" strokeWidth="8"
                        strokeDasharray={`${total * 2.64} 264`} strokeLinecap="round" className="transition-all duration-1000" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xl font-bold text-foreground">{total}%</span>
                    </div>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">
                      {total >= 80 ? 'Highly Credible' : total >= 60 ? 'Credible' : total >= 40 ? 'Moderate' : 'Building Profile'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {hasInterview
                        ? `AI Interview adds ${interviewContrib}% credibility (score: ${interviewScore}/100)`
                        : 'No AI interview taken yet — up to 20% credibility available'}
                    </p>
                  </div>
                </div>

                {/* Breakdown bars */}
                <div className="space-y-2.5">
                  {segments.map((seg) => (
                    <div key={seg.label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className={`font-medium ${seg.highlight ? 'text-purple-600 dark:text-purple-400' : 'text-foreground'}`}>
                          {seg.label}
                          {seg.highlight && (
                            <Badge variant="secondary" className="ms-1.5 text-[9px] bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400">
                              20% weight
                            </Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground">{seg.value}/{seg.max}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted/30 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${seg.color} transition-all duration-700`}
                          style={{ width: `${(seg.value / seg.max) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {!hasInterview && (
                  <div className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/20">
                    <p className="text-xs text-muted-foreground">
                      💡 This consultant has not taken an AI interview yet. Interview results can add up to 20% to their credibility score.
                    </p>
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Interview Results visible to clients */}
      <div>
        <h2 className="text-lg font-bold text-foreground mb-3 flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" /> Interview Results
          <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400">
            Optional · 20% credibility
          </Badge>
        </h2>
        <InterviewTranscript consultantId={consultant.id} viewMode="client" />
      </div>

      <BookingModal
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        consultantName={consultant.name}
        consultantId={consultant.id}
        rate={consultant.rate}
        availableSlots={detail.availableSlots}
      />

      <WriteReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        consultantId={consultant.id}
        sessionId=""
      />
    </div>
  );
}
