import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ClipboardCheck } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequest: (targetUserId: string, role: 'client' | 'consultant') => void;
  isPending?: boolean;
  parties: { id: string; name: string; role: 'client' | 'consultant' }[];
}

export default function RequestSatisfactionDialog({ open, onOpenChange, onRequest, isPending, parties }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState('');

  const handleSend = () => {
    const party = parties.find(p => p.id === selected);
    if (!party) return;
    onRequest(party.id, party.role);
    setSelected('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-primary" />
            {t('csat.request_title', 'Request Satisfaction Survey')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Label className="text-sm">{t('csat.select_party', 'Select who should fill the survey:')}</Label>
          <RadioGroup value={selected} onValueChange={setSelected}>
            {parties.map(p => (
              <div key={p.id} className="flex items-center gap-2 rounded-xl border border-border/40 p-3">
                <RadioGroupItem value={p.id} id={`party-${p.id}`} />
                <Label htmlFor={`party-${p.id}`} className="text-sm flex-1 cursor-pointer">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground ms-2 capitalize">({p.role})</span>
                </Label>
              </div>
            ))}
          </RadioGroup>

          <Button
            className="w-full gradient-primary border-0"
            onClick={handleSend}
            disabled={isPending || !selected}
          >
            {isPending ? t('csat.sending', 'Sending...') : t('csat.send_request', 'Send Survey Request')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
