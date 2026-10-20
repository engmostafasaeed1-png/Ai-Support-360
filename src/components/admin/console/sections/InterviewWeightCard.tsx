import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INTERVIEW_WEIGHT_KEY, resetInterviewWeightCache, useInterviewWeight } from '@/lib/interviewWeight';
import { clampInterviewWeight, MAX_INTERVIEW_WEIGHT } from '@/lib/profileCompleteness';

/** Admin control: how much of profile completion the AI interview is worth (profile fields get the rest). */
export default function InterviewWeightCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const saved = useInterviewWeight();
  const [value, setValue] = useState(String(saved));
  useEffect(() => { setValue(String(saved)); }, [saved]);
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= MAX_INTERVIEW_WEIGHT;

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc('admin_set_profile_interview_weight', { _weight: clampInterviewWeight(n) });
      if (error) throw error;
    },
    onSuccess: () => {
      resetInterviewWeightCache();
      qc.invalidateQueries({ queryKey: INTERVIEW_WEIGHT_KEY });
      qc.invalidateQueries({ queryKey: ['admin-incomplete-consultants'] });
      toast.success(t('admin.profileFields.weightSaved', 'AI interview share saved.'));
    },
    onError: (e: any) => toast.error(/function .* does not exist|could not find the function/i.test(e?.message || '')
      ? t('admin.profileFields.weightNeedsSql', 'This setting becomes available once the prepared database update is applied.')
      : e?.message || t('common.error', 'Something went wrong. Please try again.')),
  });

  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <Label htmlFor="interview-weight" className="text-sm">{t('admin.profileFields.weightLabel', 'AI interview share of profile completion (%)')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('admin.profileFields.weightHelp', 'Profile fields count for {{fields}}%, a completed AI interview for {{weight}}%. A pending or not-taken interview counts 0, so 100% needs a completed interview.', { fields: 100 - (valid ? n : saved), weight: valid ? n : saved })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input id="interview-weight" type="number" inputMode="numeric" min={0} max={MAX_INTERVIEW_WEIGHT} step={1} className="w-24"
            value={value} onChange={e => setValue(e.target.value)} aria-invalid={!valid} />
          <Button size="sm" disabled={!valid || n === saved || save.isPending} onClick={() => save.mutate()}>
            {t('admin.profileFields.weightSave', 'Save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
