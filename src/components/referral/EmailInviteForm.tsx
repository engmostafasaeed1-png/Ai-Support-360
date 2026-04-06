import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { getReferralLink } from '@/hooks/useReferrals';

interface Props {
  referralCode: string;
  onClose: () => void;
}

export default function EmailInviteForm({ referralCode, onClose }: Props) {
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const { isGuest } = useGuestMode();

  const handleSend = async () => {
    const emailList = emails.split(/[,;\n]/).map(e => e.trim()).filter(Boolean);
    if (!emailList.length) {
      toast.error('Please enter at least one email address.');
      return;
    }

    setSending(true);

    if (isGuest) {
      await new Promise(r => setTimeout(r, 1000));
      toast.success(`Invitations sent to ${emailList.length} people! (Demo)`);
      setSending(false);
      onClose();
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create referral records for each email
      for (const email of emailList) {
        await supabase.from('referrals').insert({
          referrer_id: user.id,
          referred_email: email,
          referral_code: referralCode,
          source: 'email',
        } as any);
      }

      toast.success(`Invitations tracked for ${emailList.length} people!`);
      onClose();
    } catch (err) {
      toast.error('Failed to send invitations.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-muted/20 rounded-xl p-4 space-y-3 border border-border/30">
      <div className="flex justify-between items-center">
        <p className="text-sm font-medium text-foreground">Send Email Invitation</p>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Email addresses (comma separated)</label>
        <Input
          placeholder="friend@company.com, colleague@corp.com"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          className="mt-1 text-sm"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Personal message (optional)</label>
        <Textarea
          placeholder="Hey! I've been using this great SAP support platform..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="mt-1 text-sm"
          rows={2}
        />
      </div>
      <div className="bg-muted/30 rounded-lg p-2 text-[10px] text-muted-foreground">
        Your referral link will be included: <span className="font-mono text-primary">{getReferralLink(referralCode).slice(0, 50)}...</span>
      </div>
      <Button className="w-full gradient-primary border-0" disabled={sending} onClick={handleSend}>
        <Send className="w-4 h-4 me-1" /> {sending ? 'Sending...' : 'Send Invitations'}
      </Button>
    </div>
  );
}
