import { useTranslation } from 'react-i18next';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { NDARecord } from './types';

interface NDARevokeDialogProps {
  nda: NDARecord | null;
  revoking: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function NDARevokeDialog({ nda, revoking, onClose, onConfirm }: NDARevokeDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={!!nda} onOpenChange={() => onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.nda_revoke_title', 'Revoke NDA')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('admin.nda_revoke_desc', 'This will invalidate the NDA between {{consultant}} and {{client}}. The consultant will need to sign a new NDA to continue working with this client.', {
              consultant: nda?.consultant_name,
              client: nda?.client_name,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
            disabled={revoking}
          >
            {revoking ? t('common.loading', 'Loading...') : t('admin.nda_revoke_confirm', 'Revoke NDA')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
