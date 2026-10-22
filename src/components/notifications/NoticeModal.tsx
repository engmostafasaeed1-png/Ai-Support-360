import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Shared shell of every notice pop-up: icon + title, "1 of N", content, then the actions. "Got it" and the X close at
 * once (the caller acknowledges in the background); "Dismiss all" appears when more notices are waiting.
 */
export default function NoticeModal({
  icon, title, description, children, position, total, onClose, onDismissAll, primary, extra, closeLabel, dismissAllLabel, testId,
}: {
  icon?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode;
  position: number; total: number;
  onClose: () => void; onDismissAll?: () => void;
  primary?: { label: string; onClick: () => void };
  extra?: ReactNode;
  closeLabel?: string; dismissAllLabel?: string; testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto rounded-2xl" onInteractOutside={(e) => e.preventDefault()} data-testid={testId}>
        <DialogHeader className="space-y-2 text-start">
          <div className="flex items-center gap-2">
            {icon}
            <DialogTitle className="leading-snug">{title}</DialogTitle>
          </div>
          {total > 1 && <p className="text-xs text-muted-foreground">{t('notice.counter', '{{n}} of {{total}}', { n: position, total })}</p>}
          {description ? <DialogDescription asChild><div>{description}</div></DialogDescription>
            : <DialogDescription className="sr-only">{typeof title === 'string' ? title : t('notice.desc', 'Notice')}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-2">
          {extra}
          {total > 1 && onDismissAll && (
            <Button variant="ghost" onClick={onDismissAll}>{dismissAllLabel ?? t('notice.dismiss_all', 'Dismiss all')}</Button>
          )}
          <Button variant={primary ? 'outline' : 'default'} onClick={onClose} autoFocus={!primary}>{closeLabel ?? t('notice.got_it', 'Got it')}</Button>
          {primary && <Button onClick={primary.onClick} autoFocus>{primary.label}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
