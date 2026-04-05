import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Calendar } from '@/components/ui/calendar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { mockRecommendedConsultants } from '@/data/clientMockData';
import { mockConsultantDetailData } from '@/data/consultantDetailMockData';
import {
  Star, MapPin, Clock, Globe, Shield, Award, Video,
  MessageSquare, Monitor, ChevronLeft, CalendarDays, BadgeCheck
} from 'lucide-react';
import { useState } from 'react';
import BookingModal from '@/components/client/BookingModal';

export default function ConsultantProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [bookingOpen, setBookingOpen] = useState(false);

  const consultant = mockRecommendedConsultants.find(c => c.id === id);
  const detail = mockConsultantDetailData;

  if (!consultant) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t('consultant_profile.not_found')}</p>
      </div>
    );
  }

  const statusColor = consultant.available ? 'bg-green-500' : 'bg-muted-foreground';

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
                  <h1 className="text-2xl font-bold text-foreground">{consultant.name}</h1>
                  <p className="text-muted-foreground">{consultant.specialty}</p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <div className="flex items-center gap-1 text-sm">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">{consultant.city}</span>
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
                  <div className="flex gap-2 mt-3">
                    {consultant.badges.map(badge => (
                      <Badge key={badge} variant="secondary" className="text-xs">
                        {t(`consultants.${badge}`)}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Stats + CTA */}
                <div className="flex flex-col items-end gap-3">
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

          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Award className="w-4 h-4 text-accent" /> {t('consultant_profile.certifications')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {detail.certifications.map((cert, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 border border-border/30">
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
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">{t('consultant_profile.industries')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {detail.industries.map(ind => (
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
                {detail.skills.map((skill, i) => (
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
                    {detail.availableSlots.map((slot, i) => (
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
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold">
                {t('consultant_profile.client_reviews')} ({consultant.reviews})
              </CardTitle>
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
                    const pct = star === 5 ? 78 : star === 4 ? 15 : star === 3 ? 5 : star === 2 ? 1 : 1;
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
              <div className="space-y-4">
                {detail.reviews.map((review, i) => (
                  <div key={i} className="p-4 rounded-xl border border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-xs font-bold text-foreground">
                          {review.avatar}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{review.client}</p>
                          <p className="text-xs text-muted-foreground">{review.date}</p>
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
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <BookingModal
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        consultantName={consultant.name}
        consultantId={consultant.id}
        rate={consultant.rate}
        availableSlots={detail.availableSlots}
      />
    </div>
  );
}
