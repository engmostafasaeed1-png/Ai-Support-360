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
  Star, MapPin, Clock, Globe, Shield, Award, Video, Lock, Linkedin, Github,
  MessageSquare, Monitor, ChevronLeft, CalendarDays, BadgeCheck, ExternalLink, Brain, EyeOff, User,
} from 'lucide-react';
import InterviewTranscript from '@/components/consultant/InterviewTranscript';
import ShareMenu from '@/components/ShareMenu';
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import WriteReviewDialog from '@/components/client/WriteReviewDialog';
import VerificationBadge, { type VerificationStatus } from '@/components/consultant/VerificationBadge';
import LinkStatus from '@/components/consultant/LinkStatus';
import ConsultantLocationMap from '@/components/client/ConsultantLocationMap';
import { STATE_META, availabilityState } from '@/lib/mapMarkers';
import { credlyProfileUrl, normalizeCredlyUsername, normalizeLinkedinUrl } from '@/lib/consultantLinks';
import { safeHttpUrl } from '@/lib/consultantReview';
import { placeLabel } from '@/lib/geo';
import { consultantPoint, formatWeeklyHours, type WeeklySlot } from '@/lib/consultantDirectory';
import ConsultantExperienceCard from '@/components/client/ConsultantExperienceCard';
import WeeklyAvailability from '@/components/client/WeeklyAvailability';
import RatingStars from '@/components/client/RatingStars';
import CredibilityAvatar from '@/components/client/CredibilityAvatar';
import { credibility } from '@/lib/consultantCredibility';
import { bookableTimes, hasWindowOn, localDateKey, type WindowRow } from '@/lib/bookableTimes';



export default function ConsultantProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [tab, setTab] = useState('about');
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
        .select('id, user_id, bio, hourly_rate, currency, languages, industries, response_time_minutes, availability_status, rating, total_reviews, verification_status, ai_skills_score, city, country, latitude, longitude, linkedin_checked_at, credly_checked_at, customer_segments, vertical_solutions, localization_countries, localization_solutions, project_types, deployment_experience, project_scale, work_modes, working_week, language_levels')
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
          avatarUrl: profile?.avatar_url ?? null,
          available: c.availability_status === 'available',
          status: availabilityState(c.availability_status),
          badges: c.verification_status === 'verified' ? ['verified'] : [],
          city: placeLabel(c.city, c.country),
          lat: consultantPoint(c)?.lat ?? null,
          lng: consultantPoint(c)?.lng ?? null,
          linkedinVerified: !!c.linkedin_checked_at,
          credlyVerified: !!c.credly_checked_at,
          linkedin_state: c.linkedin_checked_at ? 'checked' : 'none',
          credly_state: c.credly_checked_at ? 'checked' : 'none',
        },
        detail: {
          bio: c.bio || 'No bio provided yet.',
          responseTime: c.response_time_minutes || 0,
          languages: c.languages || [],
          industries: c.industries || [],
          experience: {
            industries: c.industries || [],
            customer_segments: (c as any).customer_segments || [],
            vertical_solutions: (c as any).vertical_solutions || [],
            localization_countries: (c as any).localization_countries || [],
            localization_solutions: (c as any).localization_solutions || [],
            project_types: (c as any).project_types || [],
            deployment_experience: (c as any).deployment_experience || [],
            project_scale: (c as any).project_scale || null,
            work_modes: (c as any).work_modes || [],
            working_week: (c as any).working_week || null,
            languages: c.languages || [],
            language_levels: (c as any).language_levels || null,
          },
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

  const consultant: any = isGuest ? mockRecommendedConsultants.find(c => c.id === id) : liveProfile?.consultant;
  const detail: any = isGuest ? mockConsultantDetailData : (liveProfile?.detail || mockConsultantDetailData);

  // The contact links: the view returns a row only when this consultant is assigned to one of this client's requests (administrators see every row).
  const { data: contactLinks } = useQuery({
    queryKey: ['consultant-contact-links', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await (supabase as any)
        .from('consultant_contact_links')
        .select('linkedin_url, github_url, personal_website, profile_video_url, credly_username')
        .eq('consultant_id', id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { linkedin_url: string | null; github_url: string | null; personal_website: string | null; profile_video_url: string | null; credly_username: string | null } | null;
    },
    enabled: !isGuest && !!id,
  });
  const sharedCredly = normalizeCredlyUsername(contactLinks?.credly_username);
  const sharedLinks = contactLinks ? [
    { key: 'linkedin', label: 'LinkedIn', icon: Linkedin, href: normalizeLinkedinUrl(contactLinks.linkedin_url) },
    { key: 'credly', label: 'Credly profile', icon: Award, href: credlyProfileUrl(sharedCredly) },
    { key: 'github', label: 'GitHub', icon: Github, href: safeHttpUrl(contactLinks.github_url) },
    { key: 'website', label: 'Website', icon: Globe, href: safeHttpUrl(contactLinks.personal_website) },
    { key: 'video', label: 'Video', icon: Video, href: safeHttpUrl(contactLinks.profile_video_url) },
  ].filter((l): l is { key: string; label: string; icon: typeof Linkedin; href: string } => !!l.href) : [];

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
          // The status that the consultant sets (Online, Busy, Offline), the place and the links are shown on this page too: show a change at once.
          queryClient.invalidateQueries({ queryKey: ['consultant-profile-detail', id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'availability_slots', filter: `consultant_id=eq.${id}` },
        () => {
          // The consultant edits their hours in the Session Calendar: show them at once.
          queryClient.invalidateQueries({ queryKey: ['consultant-weekly-hours', id] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, queryClient]);

  // Weekly working hours the consultant set in their Session Calendar
  const { data: weeklyHours } = useQuery({
    queryKey: ['consultant-weekly-hours', id],
    queryFn: async () => {
      if (!id) return [];
      const { data } = await supabase
        .from('availability_slots')
        .select('day_of_week, start_time, end_time')
        .eq('consultant_id', id)
        .order('day_of_week')
        .order('start_time');
      return formatWeeklyHours((data || []).filter((s): s is WeeklySlot => s.day_of_week != null));
    },
    enabled: !isGuest && !!id,
  });

  // Every window the consultant set (weekly hours and single dates). The Availability tab shows the free times of a chosen day with the same rule as the booking dialog.
  // The key starts with the key of the weekly hours, so the change notice of the database refreshes it too.
  const { data: availabilityRows } = useQuery({
    queryKey: ['consultant-weekly-hours', id, 'rows'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_slots')
        .select('day_of_week, start_time, end_time, is_recurring, specific_date')
        .eq('consultant_id', id!);
      if (error) throw error;
      return (data ?? []) as WindowRow[];
    },
    enabled: !isGuest && !!id,
  });

  // Times that are already booked with this consultant on the chosen day
  const chosenDay = selectedDate ? localDateKey(selectedDate) : '';
  const { data: bookedOnDay, isLoading: bookedLoading } = useQuery({
    queryKey: ['consultant-booked-times', id, chosenDay],
    queryFn: async () => {
      const from = new Date(selectedDate!); from.setHours(0, 0, 0, 0);
      const to = new Date(from); to.setDate(to.getDate() + 1);
      const { data, error } = await supabase.rpc('consultant_booked_times', {
        _consultant_id: id!, _from: from.toISOString(), _to: to.toISOString(),
      });
      if (error) throw error;
      return (data || []).map((b: any) => {
        const s = new Date(b.scheduled_at).getTime();
        return [s, s + (b.duration_minutes || 60) * 60_000] as [number, number];
      });
    },
    enabled: !isGuest && !!id && !!selectedDate,
  });


  const verificationStatus: VerificationStatus =
    (liveConsultant?.verification_status as VerificationStatus) ||
    (consultant?.badges?.includes('verified') ? 'verified' : 'pending');

  // Fetch Credly badges if consultant has a credly_username
  useEffect(() => {
    if (!sharedCredly) return;
    const fetchCredly = async () => {
      setCredlyLoading(true);
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const res = await fetch(
          `https://${projectId}.supabase.co/functions/v1/credly-badges?username=${encodeURIComponent(sharedCredly)}`,
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
  }, [sharedCredly]);

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
  const credibilityResult = credibility({ certifications: detail.certifications, skills: detail.skills, rating: consultant.rating, aiScore: detail.aiScore });

  // Free times of the day chosen on the Availability tab: what the consultant offers minus what is already booked. Guests see the sample times.
  const slotList: { time: string; type: string; duration: number }[] = isGuest
    ? detail.availableSlots
    : selectedDate && availabilityRows
      ? bookableTimes(selectedDate, availabilityRows, bookedOnDay ?? [], Date.now()).map((time) => ({ time, type: '', duration: 60 }))
      : [];
  const today0 = localDateKey(new Date());
  const oneDateWindows = (availabilityRows ?? [])
    .filter((r) => r.specific_date && r.specific_date >= today0)
    .sort((a, b) => `${a.specific_date}${a.start_time}`.localeCompare(`${b.specific_date}${b.start_time}`));

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
        <ChevronLeft className="w-4 h-4" /> {t('consultant_profile.back')}
      </Button>

      {/* Hero Section */}
      <Card className="rounded-2xl border-border/50 overflow-hidden" data-testid="profile-hero">
        <div className="relative h-24 sm:h-28 gradient-primary" data-testid="profile-banner">
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
            className="absolute top-3 end-3 bg-card text-card-foreground"
          />
        </div>
        <CardContent className="px-5 pb-6 sm:px-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
            <div className="relative -mt-14 shrink-0 self-start sm:-mt-16">
              <CredibilityAvatar name={consultant.name} initials={consultant.avatar} avatarUrl={consultant.avatarUrl}
                total={credibilityResult.total} statusClass={statusColor} href="#credibility" />
            </div>
            <div className="min-w-0 flex-1 md:pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground break-words">{consultant.name}</h1>
                <VerificationBadge status={verificationStatus} size="md" />
              </div>
              <p className="mt-0.5 text-base text-muted-foreground">{consultant.specialty}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span>{consultant.city || 'Location not set'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>{detail.responseTime} {t('consultant_profile.min_response')}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5 shrink-0" />
                  <span>{detail.languages.join(', ')}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium" data-testid="consultant-status">
                  <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                  {STATE_META[status].label}
                </span>
                {consultant.linkedinVerified && <LinkStatus state={consultant.linkedin_state} label="LinkedIn" />}
                {consultant.credlyVerified && <LinkStatus state={consultant.credly_state} label="Credly" />}
                {consultant.badges.map((badge: any) => (
                  <Badge key={badge} variant="secondary" className="text-xs">{t(`consultants.${badge}`)}</Badge>
                ))}
              </div>
              {!isGuest && <WeeklyAvailability hours={weeklyHours} className="mt-4" />}
            </div>
            <aside className="w-full shrink-0 space-y-3 md:w-72 md:pt-4">
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => setTab('reviews')} data-testid="rating-tile"
                  className="h-auto min-w-0 items-start justify-start whitespace-normal rounded-lg p-3 text-start">
                  <RatingStars rating={consultant.rating} reviews={consultant.reviews} />
                </Button>
                <div className="min-w-0 rounded-lg border border-border bg-card p-3">
                  <p className="break-words text-2xl font-bold leading-none text-foreground">${consultant.rate}<span className="text-sm font-medium text-muted-foreground">/hr</span></p>
                  <p className="mt-1.5 text-xs text-muted-foreground">Hourly rate</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Sessions are arranged inside a request, so everything stays protected in the portal.</p>
              <Button className="gradient-primary border-0 w-full" size="lg" onClick={() => navigate('/client/new-request')}>Open a request</Button>
            </aside>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="bg-muted/50 rounded-xl p-1">
          <TabsTrigger value="about" className="rounded-lg text-sm">{t('consultant_profile.about')}</TabsTrigger>
          <TabsTrigger value="skills" className="rounded-lg text-sm">{t('consultant_profile.skills')}</TabsTrigger>
          <TabsTrigger value="availability" className="rounded-lg text-sm">{t('consultant_profile.availability')}</TabsTrigger>
          <TabsTrigger value="reviews" className="rounded-lg text-sm">{t('consultant_profile.reviews')}</TabsTrigger>
        </TabsList>

        {/* About Tab */}
        <TabsContent value="about" className="space-y-6">
          {sharedLinks.length > 0 ? (
            <Card className="rounded-2xl border-border/50" data-testid="contact-links-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Contact links</CardTitle>
                <p className="text-xs text-muted-foreground">Shared because this consultant is assigned to your request.</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-4 text-sm">
                {sharedLinks.map(({ key, label, icon: Icon, href }) => (
                  <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-accent hover:underline">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-2xl border-border/50 opacity-70" data-testid="contact-links-locked">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold text-muted-foreground">Contact links</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Contact links are shown once this consultant is assigned to one of your requests.
                </p>
              </CardContent>
            </Card>
          )}
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

          {/* One "Experience" card: it includes the industries (the old industries card is replaced by it). */}
          <ConsultantExperienceCard data={detail.experience ?? { industries: detail.industries }} />
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
          {!isGuest && <WeeklyAvailability hours={weeklyHours} className="w-full" />}
          {!isGuest && oneDateWindows.length > 0 && (
            <Card className="rounded-2xl border-border/50" data-testid="one-date-windows">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">Also available on these dates</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {oneDateWindows.map((r) => (
                  <Badge key={`${r.specific_date}-${r.start_time}`} variant="outline" className="text-xs">
                    {format(new Date(`${r.specific_date}T00:00:00`), 'EEE, MMM d')} · {r.start_time.slice(0, 5)}–{r.end_time.slice(0, 5)}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
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
                  disabled={(date) => date < new Date() || (!isGuest && !!availabilityRows && !hasWindowOn(date, availabilityRows))}
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
                    {slotList.map((slot, i) => (
                      <div
                        key={i}
                        className="w-full flex items-center justify-between p-3 rounded-xl border border-border/50 text-start"
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
                      </div>
                    ))}
                    {!isGuest && bookedLoading && (
                      <div className="space-y-2" role="status" aria-label="Loading the free times">
                        <Skeleton className="h-11 w-full rounded-xl" />
                        <Skeleton className="h-11 w-full rounded-xl" />
                      </div>
                    )}
                    {!isGuest && !!availabilityRows && !bookedLoading && slotList.length === 0 && (
                      <p className="py-4 text-center text-sm text-muted-foreground" data-testid="no-free-times">
                        No free times on this day. Choose another day.
                      </p>
                    )}
                    <p className="mt-4 text-xs text-muted-foreground">Sessions are arranged inside a request, so everything stays protected in the portal.</p>
                    <Button className="w-full gradient-primary border-0 mt-2" onClick={() => navigate('/client/new-request')}>
                      Open a request
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
                <RatingStars rating={consultant.rating} reviews={consultant.reviews} size="lg" className="shrink-0" />
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
      <Card id="credibility" className="rounded-2xl border-border/50 scroll-mt-24">
        <CardContent className="p-6">
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" /> Profile Credibility
          </h2>
          <p className="text-xs text-muted-foreground mb-4">
            Credibility is calculated from certifications, experience, reviews, and AI interview performance.
          </p>

          {/* Credibility breakdown */}
          {(() => {
            const { total, label, hasInterview, interviewScore, interviewContrib, segments } = credibilityResult;

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
                      {label}
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

      <WriteReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        consultantId={consultant.id}
        sessionId=""
      />
    </div>
  );
}
