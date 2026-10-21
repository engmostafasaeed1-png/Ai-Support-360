import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useNamePrivacy } from '@/hooks/useNamePrivacy';
import {
  DEFAULT_NAME_FORMAT, NAME_FORMAT_LABEL, NAME_FORMATS, NAME_PRIVACY_STRINGS as S, formatConsultantName, isNameFormat, pickLang, type NameFormat,
} from '@/lib/consultantName';

/**
 * Settings > Privacy: the consultant chooses how clients see their name before the full name is unlocked,
 * with a live preview of their own name. Hidden until the database part of Feature X is installed.
 */
export default function NameFormatPicker({ consultantId }: { consultantId: string }) {
  const { i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const qc = useQueryClient();
  const privacy = useNamePrivacy();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<NameFormat>(DEFAULT_NAME_FORMAT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!privacy.data?.installed) return;
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('user_id', user.id).maybeSingle(),
        (supabase.from('consultants') as unknown as { select: (s: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { name_format?: unknown } | null }> } } })
          .select('name_format').eq('id', consultantId).maybeSingle(),
      ]);
      if (!alive) return;
      setName(p?.display_name ?? '');
      if (isNameFormat(c?.name_format)) setFormat(c.name_format);
    })();
    return () => { alive = false; };
  }, [consultantId, privacy.data?.installed]);

  if (!privacy.data?.installed) return null;

  const choose = async (next: string) => {
    if (!isNameFormat(next) || next === format) return;
    const before = format;
    setFormat(next);
    setSaving(true);
    const { error } = await supabase.from('consultants').update({ name_format: next } as never).eq('id', consultantId);
    setSaving(false);
    if (error) {
      setFormat(before);
      toast.error(pickLang(S.error, ar), { description: error.message });
      return;
    }
    toast.success(pickLang(S.saved, ar));
    qc.invalidateQueries({ queryKey: ['realtime-consultants'] });
  };

  const sample = name || (ar ? 'مصطفى سعيد' : 'Mostafa Saeed');
  return (
    <div className="space-y-3 border-t border-border/50 pt-4" data-testid="name-format-picker">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{pickLang(S.title, ar)}</p>
        <p className="text-xs text-muted-foreground">{pickLang(S.hint, ar)}</p>
        {!privacy.data.enabled && <p className="text-xs text-warning-foreground" role="status">{pickLang(S.off, ar)}</p>}
      </div>
      <RadioGroup value={format} onValueChange={(v) => void choose(v)} disabled={saving} aria-label={pickLang(S.title, ar)} className="gap-2">
        {NAME_FORMATS.map((f) => (
          <Label key={f} htmlFor={`name-format-${f}`}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/60 p-2.5 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
            <RadioGroupItem id={`name-format-${f}`} value={f} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold" dir="auto" data-testid={`name-format-sample-${f}`}>{formatConsultantName(sample, f)}</span>
              <span className="block text-xs text-muted-foreground">{pickLang(NAME_FORMAT_LABEL[f], ar)}</span>
            </span>
            {f === DEFAULT_NAME_FORMAT && <Badge variant="secondary" className="text-[10px]">{pickLang(S.recommended, ar)}</Badge>}
          </Label>
        ))}
      </RadioGroup>
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm" role="status" data-testid="name-format-preview">
        {pickLang(S.preview, ar)} <span className="font-semibold" dir="auto">{formatConsultantName(sample, privacy.data.enabled ? format : 'full')}</span>
      </p>
    </div>
  );
}
