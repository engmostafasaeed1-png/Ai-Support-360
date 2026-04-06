import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { X, Globe, Linkedin, Github } from 'lucide-react';
import type { OnboardingData } from '../ConsultantOnboarding';

const timezones = [
  'Asia/Riyadh', 'Asia/Dubai', 'Asia/Karachi', 'Europe/London',
  'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
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
];

interface Props {
  data: OnboardingData;
  onChange: (partial: Partial<OnboardingData>) => void;
}

export default function ProfileStep({ data, onChange }: Props) {
  const { t } = useTranslation();

  const toggleLang = (code: string) => {
    const langs = data.languages.includes(code)
      ? data.languages.filter(l => l !== code)
      : [...data.languages, code];
    onChange({ languages: langs });
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="displayName">{t('onboarding.display_name')} *</Label>
        <Input
          id="displayName"
          value={data.displayName}
          onChange={e => onChange({ displayName: e.target.value })}
          placeholder={t('onboarding.display_name_placeholder')}
          maxLength={100}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bio">{t('onboarding.bio')} *</Label>
        <Textarea
          id="bio"
          value={data.bio}
          onChange={e => onChange({ bio: e.target.value })}
          placeholder={t('onboarding.bio_placeholder')}
          rows={4}
          maxLength={1000}
        />
        <p className="text-[10px] text-muted-foreground text-end">{data.bio.length}/1000</p>
      </div>

      {/* Location & Personal */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label>Nationality</Label>
          <Input
            value={data.nationality}
            onChange={e => onChange({ nationality: e.target.value })}
            placeholder="Saudi"
          />
        </div>
        <div className="space-y-1.5">
          <Label>City</Label>
          <Input
            value={data.city}
            onChange={e => onChange({ city: e.target.value })}
            placeholder="Riyadh"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Country</Label>
          <Input
            value={data.country}
            onChange={e => onChange({ country: e.target.value })}
            placeholder="Saudi Arabia"
          />
        </div>
      </div>

      {/* Rate & Currency */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="hourlyRate">{t('onboarding.hourly_rate')}</Label>
          <Input
            id="hourlyRate"
            type="number"
            min={0}
            value={data.hourlyRate || ''}
            onChange={e => onChange({ hourlyRate: Number(e.target.value) })}
            placeholder="150"
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t('onboarding.currency')}</Label>
          <Select value={data.currency} onValueChange={v => onChange({ currency: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="SAR">SAR</SelectItem>
              <SelectItem value="AED">AED</SelectItem>
              <SelectItem value="GBP">GBP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('onboarding.timezone')}</Label>
          <Select value={data.timezone} onValueChange={v => onChange({ timezone: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {timezones.map(tz => (
                <SelectItem key={tz} value={tz}>{tz.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Social Links */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Social & Web Links</Label>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Linkedin className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={data.linkedinUrl}
              onChange={e => onChange({ linkedinUrl: e.target.value })}
              placeholder="https://linkedin.com/in/your-profile"
            />
          </div>
          <div className="flex items-center gap-2">
            <Github className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={data.githubUrl}
              onChange={e => onChange({ githubUrl: e.target.value })}
              placeholder="https://github.com/username"
            />
          </div>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={data.personalWebsite}
              onChange={e => onChange({ personalWebsite: e.target.value })}
              placeholder="https://your-website.com"
            />
          </div>
        </div>
      </div>

      {/* Languages */}
      <div className="space-y-1.5">
        <Label>{t('onboarding.languages')}</Label>
        <div className="flex flex-wrap gap-2">
          {allLanguages.map(lang => (
            <Badge
              key={lang.code}
              variant={data.languages.includes(lang.code) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggleLang(lang.code)}
            >
              {lang.label}
              {data.languages.includes(lang.code) && <X className="w-3 h-3 ms-1" />}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
