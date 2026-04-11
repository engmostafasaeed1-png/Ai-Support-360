import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { FileSignature, Download } from 'lucide-react';
import type { NDARecord } from './types';
import { logAudit } from '@/lib/auditLog';

interface NDAViewDialogProps {
  nda: NDARecord | null;
  onClose: () => void;
  onDownload: (nda: NDARecord) => void;
}

export default function NDAViewDialog({ nda, onClose, onDownload }: NDAViewDialogProps) {
  const { t } = useTranslation();
  const ndaContentRef = useRef<HTMLDivElement>(null);

  // Log NDA view
  useEffect(() => {
    if (nda) {
      logAudit('nda_viewed', { nda_id: nda.id, consultant: nda.consultant_name, client: nda.client_name });
    }
  }, [nda]);

  // Block copy on NDA content
  useEffect(() => {
    const el = ndaContentRef.current;
    if (!el) return;
    const block = (e: Event) => e.preventDefault();
    el.addEventListener('copy', block);
    el.addEventListener('contextmenu', block);
    el.addEventListener('selectstart', block);
    return () => {
      el.removeEventListener('copy', block);
      el.removeEventListener('contextmenu', block);
      el.removeEventListener('selectstart', block);
    };
  }, [nda]);

  return (
    <Dialog open={!!nda} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSignature className="w-5 h-5 text-primary" />
            {t('admin.nda_view_title', 'Signed NDA Details')}
          </DialogTitle>
        </DialogHeader>
        {nda && (
          <div className="space-y-4 flex-1 overflow-hidden">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">{t('admin.nda_consultant', 'Consultant')}:</span>
                <span className="ms-1 font-medium">{nda.consultant_name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('admin.nda_client', 'Client')}:</span>
                <span className="ms-1 font-medium">{nda.client_name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('admin.nda_date', 'Date Signed')}:</span>
                <span className="ms-1">{new Date(nda.signed_at).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('admin.nda_sig_type', 'Signature Type')}:</span>
                <span className="ms-1">{nda.signature_type === 'draw' ? t('nda.draw_signature') : t('nda.type_signature')}</span>
              </div>
            </div>

            <div ref={ndaContentRef} className="relative" style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 opacity-[0.06]">
                <span className="text-4xl font-bold text-foreground rotate-[-20deg]">CONFIDENTIAL</span>
              </div>
              <ScrollArea className="max-h-[200px] border rounded-lg p-4 bg-muted/30">
                <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">
                  {nda.nda_content}
                </pre>
              </ScrollArea>
            </div>

            <div className="border rounded-lg p-4">
              <p className="text-xs text-muted-foreground mb-2">{t('admin.nda_signature', 'Signature')}</p>
              {nda.signature_type === 'draw' ? (
                <img src={nda.signature_data} alt="Signature" className="max-h-24 border rounded" />
              ) : (
                <p className="text-xl font-serif italic text-foreground">{nda.signature_data}</p>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" className="gap-2" onClick={() => onDownload(nda)}>
                <Download className="w-4 h-4" />
                {t('admin.nda_download', 'Download Signature')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
