import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileSignature } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useNdaSigningSettings } from '@/hooks/useNdaSigning';
import NdaSignForm from './NdaSignForm';
import type { NdaParty } from '@/lib/nda/api';

/** Name and company from the signer's own profile, offered as suggestions only. */
export function useSignerDefaults(enabled: boolean) {
  return useQuery({
    queryKey: ['nda-signer-defaults'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { name: '', company: '' };
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.from('profiles').select('display_name').eq('user_id', user.id).maybeSingle(),
        supabase.from('client_profiles').select('company_name').eq('user_id', user.id).maybeSingle(),
      ]);
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      return {
        name: (p?.display_name as string) || (meta?.full_name as string) || (meta?.display_name as string) || '',
        company: (c?.company_name as string) || '',
      };
    },
  });
}

interface Props {
  open: boolean;
  onOpenChange(o: boolean): void;
  party: NdaParty;
  action: 'sign' | 'supplement';
  ndaId?: string | null;
  consultantId?: string | null;
  clientId?: string | null;
  /** NDA text shown above the form (the exact text being signed). */
  content?: string | null;
  otherName?: string;
  onDone?(r: { ndaId: string; signatureId: string }): void;
}

/** Review-and-sign dialog for the client's countersignature and for "Add my signature details" (both parties). */
export default function NdaSignDialog({ open, onOpenChange, party, action, ndaId, consultantId, clientId, content, otherName, onDone }: Props) {
  const { t } = useTranslation();
  const settings = useNdaSigningSettings();
  const defaults = useSignerDefaults(open);
  // the exact text being signed (read from the NDA itself when the caller did not pass it)
  const text = useQuery({
    queryKey: ['nda-text', ndaId],
    enabled: open && !!ndaId && content == null,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from('nda_agreements').select('nda_content').eq('id', ndaId!).maybeSingle();
      return (data?.nda_content as string) ?? null;
    },
  });
  const shown = content ?? text.data ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col overflow-hidden p-0 sm:p-0">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-primary" aria-hidden />
            {action === 'supplement' ? t('ndaSign.dialog.supplementTitle') : t('ndaSign.dialog.signTitle')}
          </DialogTitle>
          <DialogDescription>
            {action === 'supplement' ? t('ndaSign.dialog.supplementIntro') : otherName ? t('ndaSign.dialog.signIntroNamed', { name: otherName }) : t('ndaSign.dialog.signIntro')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5">
          {shown && (
            <ScrollArea className="max-h-[200px] rounded-xl border bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground" dir="auto">{shown}</pre>
            </ScrollArea>
          )}
          {settings.isLoading || defaults.isLoading ? (
            <p className="text-sm text-muted-foreground">{t('ndaSign.loading')}</p>
          ) : (
            <NdaSignForm
              key={`${ndaId ?? consultantId}-${action}-${open}`}
              party={party}
              action={action}
              ndaId={ndaId}
              consultantId={consultantId}
              clientId={clientId}
              defaultName={defaults.data?.name}
              defaultCompany={party === 'client' ? defaults.data?.company : undefined}
              allowTyped={!!settings.data?.allow_typed_signature}
              onCancel={() => onOpenChange(false)}
              onDone={(r) => { onOpenChange(false); onDone?.(r); }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
