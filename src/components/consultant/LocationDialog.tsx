import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import LocationPicker, { type PickedLocation } from '@/components/consultant/LocationPicker';
import { locationError } from '@/lib/consultantLocation';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PickedLocation | null;
  onSave: (country: string, city: string) => Promise<void>;
}

/** "Add your location": the picker and a single Save. Closing keeps nothing half-saved. */
export default function LocationDialog({ open, onOpenChange, initial, onSave }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState<PickedLocation>(initial ?? { country: '', city: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setValue(initial ?? { country: '', city: '' }); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const problem = locationError(value.country, value.city);
    if (problem) { setError(t('location.required', problem)); return; }
    setSaving(true);
    try {
      await onSave(value.country, value.city);
      toast.success(t('location.saved', 'Location saved.'));
      onOpenChange(false);
    } catch (e) {
      setError((e as { message?: string })?.message || t('common.error', 'Something went wrong. Please try again.'));
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" aria-hidden="true" />{t('location.dialog_title', 'Add your location')}</DialogTitle>
          <DialogDescription>{t('location.dialog_desc', 'Needed to appear in search and on the map. Only your city is shown, never an address.')}</DialogDescription>
        </DialogHeader>
        <LocationPicker idPrefix="location-dialog" value={value} onChange={v => { setValue(v); setError(null); }} error={error} />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('location.later', 'Later')}</Button>
          <Button type="button" className="gradient-primary text-primary-foreground" onClick={save} disabled={saving}>
            {saving && <Loader2 className="me-1 h-4 w-4 animate-spin motion-reduce:animate-none" />}{t('location.save', 'Save location')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
