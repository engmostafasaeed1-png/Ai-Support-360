import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { mockConsultantProfile, mockSkills } from '@/data/consultantMockData';
import { User, Globe, Clock, DollarSign, Save, RotateCcw } from 'lucide-react';
import AvatarUpload from '@/components/profile/AvatarUpload';
import ReinterviewDialog from '@/components/consultant/ReinterviewDialog';

export default function ProfilePage() {
  const { t } = useTranslation();
  const p = mockConsultantProfile;
  const [reinterviewOpen, setReinterviewOpen] = useState(false);

  return (<>
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Profile Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Keep your profile up to date to attract more clients.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setReinterviewOpen(true)}>
            <RotateCcw className="w-4 h-4 me-1" /> {t('interview.request_reinterview', 'Request Re-Interview')}
          </Button>
          <Button className="gradient-primary border-0" size="sm">
            <Save className="w-4 h-4 me-1" /> Save Changes
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <Card className="rounded-2xl border-border/50">
          <CardContent className="p-6 text-center">
            <AvatarUpload />
            <h3 className="text-lg font-bold text-foreground">{p.display_name}</h3>
            <p className="text-sm text-muted-foreground mt-1">SAP S/4HANA Finance Expert</p>
            <div className="flex items-center justify-center gap-2 mt-3">
              <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">Verified</Badge>
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-700 text-xs">Top Rated</Badge>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-xl bg-muted/50">
                <div className="text-lg font-bold text-foreground">{p.rating}</div>
                <div className="text-[10px] text-muted-foreground">Rating</div>
              </div>
              <div className="p-2 rounded-xl bg-muted/50">
                <div className="text-lg font-bold text-foreground">{p.total_reviews}</div>
                <div className="text-[10px] text-muted-foreground">Reviews</div>
              </div>
              <div className="p-2 rounded-xl bg-muted/50">
                <div className="text-lg font-bold text-foreground">{p.response_time_minutes}m</div>
                <div className="text-[10px] text-muted-foreground">Response</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Edit Form */}
        <Card className="lg:col-span-2 rounded-2xl border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <User className="w-4 h-4 text-accent" /> Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Display Name</label>
                <Input defaultValue={p.display_name} className="rounded-xl" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Phone</label>
                <Input defaultValue="+966 50 123 4567" className="rounded-xl" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Bio</label>
              <Textarea defaultValue={p.bio} rows={3} className="rounded-xl" />
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" /> Hourly Rate
                </label>
                <Input type="number" defaultValue={p.hourly_rate} className="rounded-xl" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Timezone
                </label>
                <Input defaultValue={p.timezone} className="rounded-xl" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block flex items-center gap-1">
                  <Globe className="w-3.5 h-3.5" /> Languages
                </label>
                <Input defaultValue={p.languages.join(', ')} className="rounded-xl" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">Industries</label>
              <div className="flex flex-wrap gap-2">
                {p.industries.map((ind) => (
                  <Badge key={ind} variant="secondary" className="text-xs">{ind}</Badge>
                ))}
                <Button variant="outline" size="sm" className="text-xs h-6 rounded-full">+ Add</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Skills */}
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-semibold">SAP Skills & Expertise</CardTitle>
          <Button variant="outline" size="sm" className="text-xs">+ Add Skill</Button>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {mockSkills.map((skill) => (
              <div key={skill.module} className="p-4 rounded-xl bg-muted/20 border border-border/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">{skill.module}</span>
                  {skill.certified && (
                    <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700">Certified</Badge>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{t('consultant_profile.level', 'Level')} {skill.proficiency}/5</span>
                  <span>{skill.years} {t('consultant_profile.years_exp', 'years exp')}</span>
                </div>
                <div className="flex gap-1 mt-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className={`h-1.5 flex-1 rounded-full ${i < skill.proficiency ? 'bg-accent' : 'bg-muted'}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
    <ReinterviewDialog
      open={reinterviewOpen}
      onOpenChange={setReinterviewOpen}
      consultantId={p.id}
      consultantName={p.name}
    />
  </>;
}
