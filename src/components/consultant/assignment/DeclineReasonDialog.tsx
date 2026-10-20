import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { infoActionMessage, useDeclineAssignment } from '@/hooks/useAssignmentInfo';
import { toastWithLocationFix } from '@/lib/locationErrors';
import { DECLINE_REASONS, normalizeDeclineReasons } from '../../../../supabase/functions/_shared/assignmentInfo';

interface Props {
  requestId: string | null;
  /** The reasons are stored only once the prepared SQL is applied; before that this is a plain decline. */
  ready: boolean;
  onClose: () => void;
  onDeclined?: () => void;
}

const REASON_FALLBACK: Record<string, string> = {
  not_my_module: 'Not my module', no_capacity: 'No capacity', rate_budget: 'Rate / budget', timing: 'Timing',
  info_missing: 'Needed information was not provided', other: 'Other',
};

/** Decline with optional quick-pick reasons (stored privately for "next best" suggestions and administrators). */
export default function DeclineReasonDialog({ requestId, ready, onClose, onDeclined }: Props) {
  const { t } = useTranslation();
  const decline = useDeclineAssignment(ready);
  const [reasons, setReasons] = useState<string[]>([]);
  useEffect(() => { if (requestId) setReasons([]); }, [requestId]);

  const toggle = (k: string) => setReasons((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const confirm = () => {
    if (!requestId) return;
    decline.mutate({ requestId, reasons: normalizeDeclineReasons(reasons) }, {
      onSuccess: () => {
        toast.success(t('assignment_info.declined', 'Request declined.'));
        onDeclined?.();
        onClose();
      },
      onError: (e) => toastWithLocationFix(e, infoActionMessage(e, t('assignment_info.decline_failed', 'The request could not be declined. Please try again.')), { useMessage: false }),
    });
  };

  return (
    <AlertDialog open={!!requestId} onOpenChange={(o) => { if (!o && !decline.isPending) onClose(); }}>
      <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-2xl sm:max-w-md">
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>{t('assignment_info.decline_title', 'Decline this request?')}</AlertDialogTitle>
          {ready && (
            <AlertDialogDescription className="text-start">
              {t('assignment_info.decline_hint', 'A reason is optional. It is used only to suggest better matches to the client and for administrators, and is never shown publicly.')}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {ready && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('assignment_info.reasons_label', 'Reason (optional)')}</legend>
            <div className="flex flex-wrap gap-2">
              {DECLINE_REASONS.map((k) => {
                const on = reasons.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(k)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted'}`}
                  >
                    {t(`assignment_info.reason_${k}`, REASON_FALLBACK[k])}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel disabled={decline.isPending}>{t('assignment_info.cancel', 'Cancel')}</AlertDialogCancel>
          <Button variant="outline" className="gap-1 text-destructive hover:bg-destructive/10" onClick={confirm} disabled={decline.isPending}>
            {decline.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
            {t('assignment_info.decline_confirm', 'Decline')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
