import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { logProviderEvent } from '@/lib/diagnostics';
import { useTranslateTroubleshooting } from './TranslateTroubleshootingContext';
import { supabase } from '@/integrations/supabase/client';

const GLOBAL_PREF_KEY = 'troubleshoot:lang:last';
const buildScopedKey = (userId: string | null, sessionId?: string) =>
  `troubleshoot:lang:${userId ?? 'anon'}:${sessionId ?? 'global'}`;

const isSupportedLang = (v: string | null | undefined): v is 'en' | 'ar' =>
  v === 'en' || v === 'ar';

interface TroubleshootingLanguageSwitcherProps {
  /** Forwarded to diagnostics for language-change tracking. */
  sessionId?: string;
  /** Optional className passthrough for layout tweaks. */
  className?: string;
}

const LANGS: { value: string; label: string; native: string }[] = [
  { value: 'en', label: 'English', native: 'English' },
  { value: 'ar', label: 'Arabic', native: 'العربية' },
];

/**
 * Small inline switcher shown alongside the session troubleshooting
 * panels. Changing the value calls `i18n.changeLanguage`, which triggers
 * a re-render through `useTranslation`, so the framed/fallback guidance
 * updates copy and direction (LTR/RTL) immediately without a reload.
 */
export default function TroubleshootingLanguageSwitcher({
  sessionId,
  className,
}: TroubleshootingLanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const current = i18n.language?.startsWith('ar') ? 'ar' : 'en';
  const { enabled: translateEnabled, setEnabled } = useTranslateTroubleshooting();

  const handleChange = (next: string) => {
    if (next === current) return;
    i18n.changeLanguage(next);
    if (typeof document !== 'undefined') {
      document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
      document.documentElement.lang = next;
    }
    logProviderEvent('preflight_open', {
      stage: 'language_switch',
      sessionId,
      from: current,
      to: next,
    });
  };

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    logProviderEvent('preflight_open', {
      stage: 'translate_toggle',
      sessionId,
      enabled: next,
      language: current,
    });
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-end gap-3 ${className ?? ''}`}
      role="group"
      aria-label={t('troubleshoot_lang.label', {
        defaultValue: 'Troubleshooting language',
      })}
    >
      <div className="inline-flex items-center gap-2">
        <Switch
          id="troubleshoot-translate-toggle"
          checked={translateEnabled}
          onCheckedChange={handleToggle}
          aria-label={t('troubleshoot_lang.toggle_aria', {
            defaultValue: 'Translate troubleshooting messages',
          })}
        />
        <Label
          htmlFor="troubleshoot-translate-toggle"
          className="text-xs text-muted-foreground cursor-pointer"
        >
          {translateEnabled
            ? t('troubleshoot_lang.toggle_on', {
                defaultValue: 'Translate messages',
              })
            : t('troubleshoot_lang.toggle_off', {
                defaultValue: 'Original (English)',
              })}
        </Label>
      </div>

      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Languages className="w-3.5 h-3.5" aria-hidden="true" />
        {t('troubleshoot_lang.label', { defaultValue: 'Troubleshooting language' })}
      </span>
      <Select
        value={current}
        onValueChange={handleChange}
        disabled={!translateEnabled}
      >
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LANGS.map((l) => (
            <SelectItem key={l.value} value={l.value} className="text-xs">
              <span className="font-medium">{l.native}</span>
              {l.value !== current && (
                <span className="ml-1 text-muted-foreground">· {l.label}</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
