import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { ClientOnboardingData } from '../ClientOnboarding';

const timezones = [
  'Asia/Riyadh', 'Asia/Dubai', 'Asia/Karachi', 'Europe/London',
  'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
];

const commPrefs = ['email', 'phone', 'whatsapp', 'in_app'];

interface Props {
  data: ClientOnboardingData;
  onChange: (partial: Partial<ClientOnboardingData>) => void;
}

export default function PreferencesStep({ data, onChange }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="phone">{t('client_onboarding.phone')}</Label>
        <Input
          id="phone"
          type="tel"
          value={data.phone}
          onChange={e => onChange({ phone: e.target.value })}
          placeholder="+966 50 123 4567"
          maxLength={20}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>{t('client_onboarding.preferred_language')}</Label>
          <Select value={data.preferredLanguage} onValueChange={v => onChange({ preferredLanguage: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="ar">العربية</SelectItem>
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

      <div className="space-y-1.5">
        <Label>{t('client_onboarding.communication_preference')}</Label>
        <div className="flex flex-wrap gap-2">
          {commPrefs.map(pref => (
            <Badge
              key={pref}
              variant={data.communicationPreference === pref ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => onChange({ communicationPreference: pref })}
            >
              {t(`client_onboarding.comm_${pref}`)}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
