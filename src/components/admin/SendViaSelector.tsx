import { useTranslation } from 'react-i18next';
import { Bell, Mail, MessageCircle, Smartphone } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  activePreset, CHANNEL_REASON_TEXT, PRESET_ORDER, presetSelection, presetUsable, RECOMMENDED_PRESET, SEND_CHANNELS, toggleChannel,
  type ChannelMap, type SendChannel, type SendPreset,
} from '@/lib/sendChannels';

const ICON: Record<SendChannel, typeof Bell> = { in_app: Bell, email: Mail, push: Smartphone, telegram: MessageCircle };
const LABEL_EN: Record<SendChannel, string> = { in_app: 'In-app notification', email: 'E-mail', push: 'Push (Web Push)', telegram: 'Telegram' };
const HINT_EN: Record<SendChannel, string> = {
  in_app: 'Bell card in the portal.',
  email: 'To confirmed e-mail addresses.',
  push: 'Only people who enabled push notifications on a device.',
  telegram: 'Only people who connected Telegram.',
};
const PRESET_EN: Record<SendPreset, string> = {
  in_app_only: 'In-app only', email_only: 'E-mail only', in_app_email: 'In-app + E-mail (recommended)', all: 'All available channels',
};

/**
 * "Send via": presets + one checkbox per channel with the number of people it reaches. Unavailable channels stay visible,
 * disabled, with the reason, so nothing is dropped silently. The server checks every channel again.
 */
export default function SendViaSelector({ value, onChange, info, idPrefix, channels = SEND_CHANNELS, showCounts = true, disabled }: {
  value: SendChannel[]; onChange: (v: SendChannel[]) => void; info: ChannelMap; idPrefix: string;
  channels?: readonly SendChannel[]; showCounts?: boolean; disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const nf = new Intl.NumberFormat(i18n.language?.startsWith('ar') ? 'ar' : 'en');
  const current = activePreset(value, info);
  const reasonText = (r?: string | null) => (r ? t(`chan.r_${r}`, CHANNEL_REASON_TEXT[r as keyof typeof CHANNEL_REASON_TEXT] ?? r) : '');
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-semibold">{t('chan.send_via', 'Send via')}</legend>
      <div role="group" aria-label={t('chan.presets', 'Quick choices')} className="flex flex-wrap gap-1.5">
        {PRESET_ORDER.map((p) => {
          const usable = presetUsable(p, info);
          const partial = usable && presetSelection(p, info).length < (p === 'all' ? 0 : 99) && false;
          return (
            <button key={p} type="button" disabled={!usable || disabled} aria-pressed={current === p}
              onClick={() => onChange(presetSelection(p, info))}
              className={cn('rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                current === p ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted', partial && 'border-dashed')}>
              {t(`chan.p_${p}`, PRESET_EN[p])}
            </button>
          );
        })}
      </div>
      <ul className="space-y-1.5">
        {channels.map((c) => {
          const ci = info[c];
          const ok = ci?.available === true;
          const Icon = ICON[c];
          const id = `${idPrefix}-ch-${c}`;
          const skipped = Object.entries(ci?.skipped ?? {}).filter(([, n]) => n > 0);
          return (
            <li key={c} className={cn('flex items-start gap-2.5 rounded-xl border p-2.5', !ok && 'border-dashed opacity-80')}>
              <Checkbox id={id} checked={ok && value.includes(c)} disabled={!ok || disabled} onCheckedChange={(v) => onChange(toggleChannel(value, c, !!v, info))} className="mt-0.5" aria-describedby={`${id}-hint`} />
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Label htmlFor={id} className="text-sm font-medium">{t(`chan.c_${c}`, LABEL_EN[c])}</Label>
                  {ok && showCounts && typeof ci?.eligible === 'number' && (
                    <Badge variant="secondary" className="tabular-nums">{t('chan.reach_n', '{{n}} will receive it', { n: nf.format(ci.eligible) })}</Badge>
                  )}
                  {!ok && <Badge variant="outline">{t('chan.unavailable', 'Not available')}</Badge>}
                </div>
                <p id={`${id}-hint`} className="text-muted-foreground">{ok ? t(`chan.h_${c}`, HINT_EN[c]) : reasonText(ci?.reason)}</p>
                {ok && skipped.length > 0 && (
                  <p className="text-muted-foreground">{skipped.map(([r, n]) => t('chan.skip_n', '{{n}} skipped: {{why}}', { n: nf.format(n), why: reasonText(r) })).join(' · ')}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {current === null && value.length > 0 && <p className="text-[11px] text-muted-foreground">{t('chan.custom', 'Custom choice')}</p>}
      {value.length === 0 && <p className="text-xs text-destructive" role="alert">{t('chan.none', 'Choose at least one channel.')}</p>}
      <p className="sr-only">{t('chan.recommended_is', 'Recommended: {{p}}', { p: t(`chan.p_${RECOMMENDED_PRESET}`, PRESET_EN[RECOMMENDED_PRESET]) })}</p>
    </fieldset>
  );
}
