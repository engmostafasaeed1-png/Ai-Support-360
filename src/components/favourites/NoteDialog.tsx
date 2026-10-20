import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { cleanTags, FAV_LIMITS } from '@/lib/clientFavourites';

/** Private note and free tags for one consultant (only the client's organisation sees them). */
export default function NoteDialog({ open, onOpenChange, name, note, tags, readOnly, onSave, saving }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  note: string;
  tags: string[];
  readOnly?: boolean;
  onSave: (note: string, tags: string[]) => void | Promise<void>;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(note);
  const [tagText, setTagText] = useState(tags.join(', '));
  useEffect(() => { if (open) { setText(note); setTagText(tags.join(', ')); } }, [open, note, tags]);
  const parsed = cleanTags(tagText.split(','));
  const tooLong = text.trim().length > FAV_LIMITS.note;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('fav.note_title', { name })}</DialogTitle>
          <DialogDescription>{t('fav.note_private')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fav-note">{t('fav.note')}</Label>
            <Textarea id="fav-note" rows={5} value={text} readOnly={readOnly} onChange={(e) => setText(e.target.value)} aria-describedby="fav-note-count" />
            <p id="fav-note-count" className={cn('text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')}>{text.trim().length} / {FAV_LIMITS.note}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fav-tags">{t('fav.tags')}</Label>
            <Input id="fav-tags" value={tagText} readOnly={readOnly} onChange={(e) => setTagText(e.target.value)} placeholder={t('fav.tags_ph')} aria-describedby="fav-tags-help" />
            <p id="fav-tags-help" className={cn('text-xs', parsed.error ? 'text-destructive' : 'text-muted-foreground')}>
              {parsed.error ? t(`fav.err.fav_${parsed.error}`) : t('fav.tags_help', { max: FAV_LIMITS.tags })}
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? t('fav.close') : t('common.cancel', 'Cancel')}</Button>
          {!readOnly && <Button type="button" disabled={saving || tooLong || !!parsed.error} onClick={() => void onSave(text, parsed.tags)}>{t('fav.save')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
