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

const countries = [
  'Saudi Arabia', 'UAE', 'Qatar', 'Kuwait', 'Bahrain', 'Oman',
  'Egypt', 'Jordan', 'Lebanon', 'Iraq', 'Morocco', 'Tunisia',
  'United States', 'United Kingdom', 'Germany', 'France', 'Netherlands',
  'India', 'Pakistan', 'Philippines', 'Malaysia', 'Singapore',
  'Turkey', 'South Africa', 'Nigeria', 'Brazil', 'Canada', 'Australia',
  'Japan', 'South Korea', 'China', 'Indonesia', 'Thailand', 'Vietnam',
  'Italy', 'Spain', 'Poland', 'Switzerland', 'Sweden', 'Ireland',
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

const citiesByCountry: Record<string, string[]> = {
  'Saudi Arabia': ['Riyadh', 'Jeddah', 'Dammam', 'Khobar', 'Mecca', 'Medina', 'Tabuk', 'Abha'],
  'UAE': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah'],
  'Qatar': ['Doha', 'Al Wakrah', 'Al Khor', 'Lusail'],
  'Kuwait': ['Kuwait City', 'Hawalli', 'Salmiya'],
  'Bahrain': ['Manama', 'Riffa', 'Muharraq'],
  'Oman': ['Muscat', 'Salalah', 'Sohar'],
  'Egypt': ['Cairo', 'Alexandria', 'Giza', 'Sharm El Sheikh'],
  'Jordan': ['Amman', 'Aqaba', 'Irbid'],
  'Lebanon': ['Beirut', 'Tripoli', 'Sidon'],
  'India': ['Mumbai', 'Bangalore', 'Hyderabad', 'Delhi', 'Chennai', 'Pune', 'Kolkata', 'Noida', 'Gurgaon'],
  'Pakistan': ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi'],
  'United States': ['New York', 'San Francisco', 'Chicago', 'Dallas', 'Houston', 'Atlanta', 'Los Angeles', 'Seattle', 'Boston'],
  'United Kingdom': ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Leeds'],
  'Germany': ['Berlin', 'Munich', 'Frankfurt', 'Hamburg', 'Cologne', 'Walldorf'],
  'France': ['Paris', 'Lyon', 'Marseille', 'Toulouse'],
  'Netherlands': ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht'],
  'Singapore': ['Singapore'],
  'Malaysia': ['Kuala Lumpur', 'Penang', 'Johor Bahru'],
  'Philippines': ['Manila', 'Cebu', 'Davao'],
  'Turkey': ['Istanbul', 'Ankara', 'Izmir'],
  'South Africa': ['Johannesburg', 'Cape Town', 'Durban'],
  'Nigeria': ['Lagos', 'Abuja', 'Port Harcourt'],
  'Brazil': ['São Paulo', 'Rio de Janeiro', 'Brasília'],
  'Canada': ['Toronto', 'Vancouver', 'Montreal', 'Calgary'],
  'Australia': ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
  'Japan': ['Tokyo', 'Osaka', 'Nagoya'],
  'South Korea': ['Seoul', 'Busan'],
  'China': ['Shanghai', 'Beijing', 'Shenzhen', 'Guangzhou'],
};

const currencies = ['USD', 'EUR', 'SAR', 'AED', 'GBP', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP', 'INR', 'PKR', 'MYR', 'SGD', 'AUD', 'CAD', 'CHF'];

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

  const availableCities = data.country ? (citiesByCountry[data.country] || []) : [];

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
          <Select value={data.nationality} onValueChange={v => onChange({ nationality: v })}>
            <SelectTrigger><SelectValue placeholder="Select nationality" /></SelectTrigger>
            <SelectContent>
              {nationalities.map(n => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Country</Label>
          <Select value={data.country} onValueChange={v => onChange({ country: v, city: '' })}>
            <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
            <SelectContent>
              {countries.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>City</Label>
          <Select value={data.city} onValueChange={v => onChange({ city: v })} disabled={!data.country}>
            <SelectTrigger><SelectValue placeholder={data.country ? 'Select city' : 'Select country first'} /></SelectTrigger>
            <SelectContent>
              {availableCities.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Rate & Currency */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="hourlyRate">{t('onboarding.hourly_rate')}</Label>
          <Select value={data.hourlyRate ? String(data.hourlyRate) : ''} onValueChange={v => onChange({ hourlyRate: Number(v) })}>
            <SelectTrigger><SelectValue placeholder="Select rate" /></SelectTrigger>
            <SelectContent>
              {[25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500].map(r => (
                <SelectItem key={r} value={String(r)}>{r}/hr</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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

      {/* Languages - Multi-select badges */}
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
