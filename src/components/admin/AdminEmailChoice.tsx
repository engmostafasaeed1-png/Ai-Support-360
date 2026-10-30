import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Mail } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { adminEmailHeader, canUntickEmail } from '@/lib/adminMessageEmail';

export interface AdminEmailValue { email: boolean; important: boolean; includeTests: boolean }
export const DEFAULT_ADMIN_EMAIL: AdminEmailValue = { email: true, important: false, includeTests: false };
/** Header value for this send (see src/lib/adminMessageEmail.ts). */
export const headerFor = (type: string, v: AdminEmailValue) => adminEmailHeader({ type, ...v });

/**
 * "Also send by e-mail" on an admin send box. Decisions and notices are locked on (no value needed); comments can be
 * unticked (the database logs it) and any message can be marked important (sent even while the person paused quiet
 * notifications) or include test-tagged accounts.
 */
export default function AdminEmailChoice({ type, value, onChange, locked: lockedProp }: { type: string; value?: AdminEmailValue; onChange?: (v: AdminEmailValue) => void; locked?: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const locked = lockedProp || !canUntickEmail(type) || !onChange;
  const v = value ?? DEFAULT_ADMIN_EMAIL;
  if (locked && !onChange) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="note">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t('ame.locked', 'Also sent by e-mail to this person (always on for decisions and notices).')}</span>
      </p>
    );
  }
  return (
    <fieldset className="space-y-1.5 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
      <legend className="sr-only">{t('ame.legend', 'E-mail')}</legend>
      {locked ? (
        <p className="flex items-start gap-1.5 font-medium"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t('ame.locked', 'Also sent by e-mail to this person (always on for decisions and notices).')}</p>
      ) : (
        <div className="flex items-center gap-2">
          <Switch id={`${id}-e`} checked={v.email} onCheckedChange={(c) => onChange!({ ...v, email: c })} />
          <Label htmlFor={`${id}-e`} className="flex items-center gap-1 text-xs font-medium"><Mail className="h-3.5 w-3.5" aria-hidden />{t('ame.also_email', 'Also send by e-mail')}</Label>
        </div>
      )}
      {!locked && !v.email && <p className="ps-6 text-muted-foreground">{t('ame.unticked', 'Only for a minor comment. This choice is recorded.')}</p>}
      {(locked || v.email) && (
        <>
          <div className="flex items-center gap-2 ps-6">
            <Checkbox id={`${id}-i`} checked={v.important} onCheckedChange={(c) => onChange!({ ...v, important: c === true })} />
            <Label htmlFor={`${id}-i`} className="text-xs">{t('ame.important', 'Important: send even if they paused quiet notifications')}</Label>
          </div>
          <div className="flex items-center gap-2 ps-6">
            <Checkbox id={`${id}-t`} checked={v.includeTests} onCheckedChange={(c) => onChange!({ ...v, includeTests: c === true })} />
            <Label htmlFor={`${id}-t`} className="text-xs">{t('ame.include_tests', 'Include test accounts')}</Label>
          </div>
        </>
      )}
    </fieldset>
  );
}
