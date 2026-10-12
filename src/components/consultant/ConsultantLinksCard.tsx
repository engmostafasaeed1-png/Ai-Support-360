import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, ExternalLink, Github, Globe, Linkedin, Loader2, MapPin, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { COUNTRIES, citiesOf, cityPoint } from '@/lib/geo';
import {
  CREDLY_HINT,
  LINKEDIN_HINT,
  credlyProfileUrl,
  linkState,
  normalizeCredlyUsername,
  normalizeLinkedinUrl,
} from '@/lib/consultantLinks';
import LinkStatus from '@/components/consultant/LinkStatus';

const MINE_KEY = ['my-consultant-links'];

async function loadMine() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('consultants')
    .select('id, city, country, linkedin_checked_at, credly_checked_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // The links are read from the view of contact links (the consultant's own row).
  const { data: links, error: linksError } = await (supabase as any)
    .from('consultant_contact_links')
    .select('linkedin_url, github_url, personal_website, credly_username')
    .eq('consultant_id', data.id)
    .maybeSingle();
  if (linksError) throw linksError;
  return {
    ...data,
    linkedin_url: (links?.linkedin_url ?? null) as string | null,
    github_url: (links?.github_url ?? null) as string | null,
    personal_website: (links?.personal_website ?? null) as string | null,
    credly_username: (links?.credly_username ?? null) as string | null,
    user_id: user.id,
  };
}

/** The consultant's place (clients see it as an area on a map) and the links to LinkedIn and Credly, with what the platform team has checked. */
export default function ConsultantLinksCard() {
  const qc = useQueryClient();
  const { data: me, isLoading } = useQuery({ queryKey: MINE_KEY, queryFn: loadMine });
  const [form, setForm] = useState({ country: '', city: '', linkedin: '', github: '', website: '', credly: '' });
  const [problem, setProblem] = useState<{ linkedin?: string; credly?: string }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!me) return;
    setForm({
      country: me.country ?? '',
      city: me.city ?? '',
      linkedin: me.linkedin_url ?? '',
      github: me.github_url ?? '',
      website: me.personal_website ?? '',
      credly: me.credly_username ?? '',
    });
  }, [me]);

  const save = async () => {
    if (!me) return;
    const linkedin = form.linkedin.trim() ? normalizeLinkedinUrl(form.linkedin) : null;
    const credly = form.credly.trim() ? normalizeCredlyUsername(form.credly) : null;
    const next: { linkedin?: string; credly?: string } = {};
    if (form.linkedin.trim() && !linkedin) next.linkedin = LINKEDIN_HINT;
    if (form.credly.trim() && !credly) next.credly = CREDLY_HINT;
    setProblem(next);
    if (next.linkedin || next.credly) return;

    const place = form.country && form.city ? cityPoint(form.country, form.city) : null;
    setSaving(true);
    const { error } = await supabase
      .from('consultants')
      .update({
        city: form.city || null,
        country: form.country || null,
        latitude: place ? place.lat : null,
        longitude: place ? place.lng : null,
        linkedin_url: linkedin,
        github_url: form.github.trim() || null,
        personal_website: form.website.trim() || null,
        credly_username: credly,
      })
      .eq('user_id', me.user_id);
    setSaving(false);
    if (error) {
      toast.error(error.code === '22023' && error.message ? error.message : 'Could not save your place and links. Please try again.');
      return;
    }
    toast.success('Saved');
    for (const key of [MINE_KEY, ['consultant-profile'], ['realtime-consultants'], ['consultant-dashboard']]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };

  const linkedinHref = normalizeLinkedinUrl(form.linkedin);
  const credlyHref = credlyProfileUrl(form.credly);
  const cities = citiesOf(form.country);

  return (
    <Card className="rounded-2xl border-border/50" data-testid="consultant-links-card">
      <CardHeader>
        <CardTitle className="text-base">Place and links</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading || !me ? (
          <p className="text-sm text-muted-foreground">{isLoading ? 'Loading…' : 'Your consultant profile was not found.'}</p>
        ) : (
          <>
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm font-medium"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Where you work from</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Country</Label>
                  <Select value={COUNTRIES.includes(form.country) ? form.country : ''} onValueChange={v => setForm(f => ({ ...f, country: v, city: '' }))}>
                    <SelectTrigger aria-label="Country"><SelectValue placeholder="Select country" /></SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>City</Label>
                  <Select value={cities.includes(form.city) ? form.city : ''} onValueChange={v => setForm(f => ({ ...f, city: v }))} disabled={!form.country}>
                    <SelectTrigger aria-label="City"><SelectValue placeholder={form.country ? 'Select city' : 'Select country first'} /></SelectTrigger>
                    <SelectContent>
                      {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Clients see the area of your city on a map, never an address. Without a city you do not appear on the map.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="cl-linkedin" className="flex items-center gap-1.5"><Linkedin className="h-3.5 w-3.5" aria-hidden="true" /> LinkedIn profile</Label>
                  <LinkStatus state={linkState(me.linkedin_url, me.linkedin_checked_at)} label="LinkedIn" />
                </div>
                <div className="flex items-center gap-2">
                  <Input id="cl-linkedin" value={form.linkedin} onChange={e => setForm(f => ({ ...f, linkedin: e.target.value }))} placeholder="https://www.linkedin.com/in/your-name" />
                  {linkedinHref && (
                    <a href={linkedinHref} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Open the LinkedIn page in a new tab">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
                {problem.linkedin && <p className="text-[11px] text-destructive" role="alert">{problem.linkedin}</p>}
              </div>

              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Label htmlFor="cl-credly" className="flex items-center gap-1.5"><Award className="h-3.5 w-3.5" aria-hidden="true" /> Credly profile</Label>
                  <LinkStatus state={linkState(me.credly_username, me.credly_checked_at)} label="Credly" />
                </div>
                <div className="flex items-center gap-2">
                  <Input id="cl-credly" value={form.credly} onChange={e => setForm(f => ({ ...f, credly: e.target.value }))} placeholder="Your Credly username or profile address" />
                  {credlyHref && (
                    <a href={credlyHref} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Open the Credly page in a new tab">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
                {problem.credly && <p className="text-[11px] text-destructive" role="alert">{problem.credly}</p>}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cl-github" className="flex items-center gap-1.5"><Github className="h-3.5 w-3.5" aria-hidden="true" /> GitHub (optional)</Label>
                  <Input id="cl-github" value={form.github} onChange={e => setForm(f => ({ ...f, github: e.target.value }))} placeholder="https://github.com/username" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cl-website" className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" aria-hidden="true" /> Website (optional)</Label>
                  <Input id="cl-website" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://your-website.com" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                LinkedIn and Credly start as "linked". The platform team opens the link and marks it "checked". If you change a link, the check starts again.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save place and links
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
