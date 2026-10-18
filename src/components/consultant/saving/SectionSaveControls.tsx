import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SectionSave } from '@/hooks/useSectionAutosave';
export default function SectionSaveControls({ state, disabled = false }: { state: SectionSave; disabled?: boolean }) {
  const { t } = useTranslation();
  const status = state.saving ? t('profile_save.saving', 'Saving...') : state.dirty
    ? state.automatic && !state.error ? t('profile_save.pending', 'Unsaved changes - saving in 4 s') : t('profile_save.unsaved', 'Unsaved changes')
    : state.savedNow ? t('profile_save.just_now', 'Saved just now') : t('profile_save.all_saved', 'All changes saved');
  return <div className="space-y-1.5">
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span role="status" className="text-xs text-muted-foreground">{status}</span>
      <Button type="button" size="sm" disabled={disabled || state.saving || !state.dirty} onClick={state.manualSave}><Save className="h-4 w-4 me-1" />{t('common.save', 'Save')}</Button>
    </div>
    {state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
  </div>;
}
