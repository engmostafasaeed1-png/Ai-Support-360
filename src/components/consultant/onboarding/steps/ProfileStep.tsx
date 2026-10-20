import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { X, Globe, Linkedin, Github, Award, MapPin } from 'lucide-react';
import { COUNTRIES, citiesOf } from '@/lib/geo';
import { CREDLY_HINT, LINKEDIN_HINT, normalizeCredlyUsername, normalizeLinkedinUrl } from '@/lib/consultantLinks';
import type { OnboardingData } from '../ConsultantOnboarding';
import { FieldHint } from '../OnboardingGuidePanel';
import { FieldGate, RequiredMark } from '@/components/consultant/ProfileFieldRule';
import CityPicker from './CityPicker';
import { locationError, LOCATION_REQUIRED_MESSAGE } from '@/lib/consultantLocation';

const timezones = [
  'Asia/Riyadh', 'Asia/Dubai', 'Asia/Karachi', 'Europe/London',
  'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  'Africa/Cairo', 'Asia/Istanbul', 'Asia/Kuala_Lumpur', 'Asia/Manila',
];

const allLanguages = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ur', label: 'اردو' },
  { code: 'zh', label: '中文' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'tr', label: 'Türkçe' },
];

const nationalities = [
  'Saudi', 'Emirati', 'Qatari', 'Kuwaiti', 'Bahraini', 'Omani',
  'Egyptian', 'Jordanian', 'Lebanese', 'Iraqi', 'Moroccan', 'Tunisian',
  'American', 'British', 'German', 'French', 'Dutch',
  'Indian', 'Pakistani', 'Filipino', 'Malaysian', 'Singaporean',
  'Turkish', 'South African', 'Nigerian', 'Brazilian', 'Canadian', 'Australian',
  'Japanese', 'Korean', 'Chinese', 'Indonesian', 'Thai', 'Vietnamese',
  'Italian', 'Spanish', 'Polish', 'Swiss', 'Swedish', 'Irish',
];

const currencies = ['USD', 'EUR', 'SAR', 'AED', 'GBP', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP', 'INR', 'PKR', 'MYR', 'SGD', 'AUD', 'CAD', 'CHF'];

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
  renderSection?: (keys: (keyof OnboardingData)[], children: ReactNode, manual?: boolean) => ReactNode;
}

export default function ProfileStep({ data, onChange, renderSection }: Props) {
  const { t } = useTranslation();
  const section = renderSection ?? ((_keys: (keyof OnboardingData)[], children: ReactNode) => children);

  const toggleLang = (code: string) => {
    const langs = data.languages.includes(code)
      ? data.languages.filter(l => l !== code)
      : [...data.languages, code];
    onChange({ languages: langs });
  };

  const availableCities = data.country ? citiesOf(data.country) : [];
  const linkedinBad = !!data.linkedinUrl.trim() && !normalizeLinkedinUrl(data.linkedinUrl);
  const credlyBad = !!data.credlyUsername.trim() && !normalizeCredlyUsername(data.credlyUsername);

  return (
    <div className="space-y-5">
      {section(['displayName', 'bio'], <><FieldGate field="display_name"><div className="space-y-1.5">
        <Label htmlFor="displayName">{t('onboarding.display_name')}<RequiredMark field="display_name" /></Label><FieldHint field="displayName" />
        <Input
          id="displayName"
          value={data.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
          placeholder={t('onboarding.display_name_placeholder')}
          maxLength={100}
        />
      </div></FieldGate>

      <FieldGate field="bio"><div className="space-y-1.5">
        <Label htmlFor="bio">{t('onboarding.bio')}<RequiredMark field="bio" /></Label><FieldHint field="bio" />
        <Textarea
          id="bio"
          value={data.bio}
          onChange={e => onChange({ bio: e.target.value })}
          placeholder={t('onboarding.bio_placeholder')}
          rows={4}
          maxLength={8000}
        />
        <p className="text-[10px] text-muted-foreground text-end">{data.bio.length}/8000</p>
      </div></FieldGate>

      </>)}
      {/* Location & Personal */}
      {section(['nationality', 'country', 'city'], <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FieldGate field="nationality"><div className="space-y-1.5">
          <Label>Nationality<RequiredMark field="nationality" /></Label>
          <Select value={data.nationality} onValueChange={v => onChange({ nationality: v })}>
            <SelectTrigger><SelectValue placeholder="Select nationality" /></SelectTrigger>
            <SelectContent>
              {nationalities.map(n => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div></FieldGate>
        <FieldGate field="country"><div className="space-y-1.5">
          <Label>Country<RequiredMark field="country" /></Label>
          <Select value={COUNTRIES.includes(data.country) ? data.country : ''} onValueChange={v => onChange({ country: v, city: '' })}>
            <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
            <SelectContent>
              {COUNTRIES.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div></FieldGate>
        <FieldGate field="city"><div className="space-y-1.5">
          <Label>City<RequiredMark field="city" /></Label>
          <CityPicker country={data.country} city={data.city} cities={availableCities} onChange={city => onChange({ city })} />
        </div></FieldGate>
      </div>
      <p className="-mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
        Choose your city so that clients find you on the map. They see the area of the city, never an address.
      </p>
      {locationError(data.country, data.city) && (
        <p role="alert" data-testid="location-required" className="-mt-2 text-xs text-destructive">{t('location.required', LOCATION_REQUIRED_MESSAGE)}</p>
      )}

      </>)}
      {/* Rate & Currency */}
      {section(['hourlyRate', 'currency', 'timezone'], <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FieldGate field="hourly_rate"><div className="space-y-1.5">
          <Label htmlFor="hourlyRate">{t('onboarding.hourly_rate')}<RequiredMark field="hourly_rate" /></Label><FieldHint field="hourlyRate" />
          <Input id="hourlyRate" type="number" min={0} step="0.01" value={data.hourlyRate} onChange={e => onChange({ hourlyRate: Number(e.target.value) })} />
        </div></FieldGate>
        <div className="space-y-1.5">
          <Label>{t('onboarding.currency')}</Label>
          <Select value={data.currency} onValueChange={v => onChange({ currency: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {currencies.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FieldGate field="timezone"><div className="space-y-1.5">
          <Label>{t('onboarding.timezone')}<RequiredMark field="timezone" /></Label><FieldHint field="timezone" />
          <Select value={data.timezone} onValueChange={v => onChange({ timezone: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {timezones.map(tz => (
                <SelectItem key={tz} value={tz}>{tz.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div></FieldGate>
      </div>

      </>)}
      {/* Social Links */}
      {section(['linkedinUrl', 'credlyUsername', 'githubUrl', 'personalWebsite'], <>
      <FieldGate field={['linkedin_url', 'credly_username', 'github_url', 'personal_website']}><div className="space-y-3">
        <div className="flex items-center"><Label className="text-sm font-medium">Social & Web Links</Label><FieldHint field="linkedin" /></div>
        <div className="space-y-2">
          <FieldGate field="linkedin_url"><div className="flex items-center gap-2">
            <Linkedin className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={data.linkedinUrl}
              onChange={e => onChange({ linkedinUrl: e.target.value })}
              placeholder="https://www.linkedin.com/in/your-name"
              aria-label="LinkedIn profile address"
            /><RequiredMark field="linkedin_url" />
          </div>
          {linkedinBad && <p className="text-[11px] text-destructive" role="alert">{LINKEDIN_HINT}</p>}</FieldGate>
          <FieldGate field="credly_username"><div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={data.credlyUsername}
              onChange={e => onChange({ credlyUsername: e.target.value })}
              placeholder="Your Credly username or profile address"
              aria-label="Credly username or profile address"
            /><RequiredMark field="credly_username" />
          </div>
          {credlyBad && <p className="text-[11px] text-destructive" role="alert">{CREDLY_HINT}</p>}</FieldGate>
          <FieldGate field="github_url"><div className="flex items-center gap-2">
            <Github className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={data.githubUrl}
              onChange={e => onChange({ githubUrl: e.target.value })}
              placeholder="https://github.com/username"
              aria-label="GitHub profile address"
            /><RequiredMark field="github_url" />
          </div></FieldGate>
          <FieldGate field="personal_website"><div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={data.personalWebsite}
              onChange={e => onChange({ personalWebsite: e.target.value })}
              placeholder="https://your-website.com"
              aria-label="Personal website address"
            /><RequiredMark field="personal_website" />
          </div></FieldGate>
        </div>
        <p className="text-[11px] text-muted-foreground">
          The platform team opens your LinkedIn and Credly links when it reviews your application. Clients see them as "linked", and as "checked" once the team confirmed them.
        </p>
      </div></FieldGate>

      <p className="text-xs text-muted-foreground">{t('profile_save.links_manual', 'Changing LinkedIn or Credly links clears their checked status. Save links manually.')}</p>
      </>, true)}
      {/* Languages - Multi-select badges */}
      {section(['languages'], <>
      <FieldGate field="languages"><div className="space-y-1.5">
        <Label>{t('onboarding.languages')}<RequiredMark field="languages" /></Label><FieldHint field="languages" />
        <div className="flex flex-wrap gap-2">
          {allLanguages.map(lang => (
            <Button type="button"
              key={lang.code}
              variant={data.languages.includes(lang.code) ? 'default' : 'outline'} size="sm" aria-pressed={data.languages.includes(lang.code)}
              className="cursor-pointer"
              onClick={() => toggleLang(lang.code)}
            >
              {lang.label}
              {data.languages.includes(lang.code) && <X className="w-3 h-3 ms-1" />}
            </Button>
          ))}
        </div>
      </div></FieldGate></>)}
    </div>
  );
}
