import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Briefcase, Users, Mail, Copy, MessageCircle, Linkedin, Send, Smartphone, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const SITE = 'https://www.aisupport360.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
type Role = 'consultant' | 'client';

export default function InviteUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [role, setRole] = useState<Role>('consultant');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => {
    const p = new URLSearchParams({ role, invite: 'admin' });
    if (EMAIL_RE.test(email.trim())) p.set('email', email.trim().toLowerCase());
    return `${SITE}/signup?${p.toString()}`;
  }, [role, email]);

  const shareText = useMemo(() => {
    const hi = name.trim() ? `Hi ${name.trim()}, ` : '';
    const body = role === 'consultant'
      ? 'you are invited to join AI Support 360 as a consultant — get matched with client tickets that fit your expertise.'
      : 'you are invited to AI Support 360 — open a ticket and get matched with verified experts in minutes.';
    return `${hi}${body}${message.trim() ? `\n\n${message.trim()}` : ''}\n\nSign up here: ${link}`;
  }, [name, role, message, link]);

  const enc = encodeURIComponent;
  const channels = [
    { label: 'WhatsApp', icon: MessageCircle, href: `https://wa.me/?text=${enc(shareText)}` },
    { label: 'LinkedIn', icon: Linkedin, href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(link)}` },
    { label: 'Telegram', icon: Send, href: `https://t.me/share/url?url=${enc(link)}&text=${enc(shareText)}` },
    { label: 'SMS', icon: Smartphone, href: `sms:?&body=${enc(shareText)}` },
    { label: 'Own email app', icon: Mail, href: `mailto:${enc(email.trim())}?subject=${enc("You're invited to AI Support 360")}&body=${enc(shareText)}` },
  ];

  const sendEmail = async () => {
    if (!EMAIL_RE.test(email.trim())) { toast.error('Enter a valid email address'); return; }
    setSending(true);
    const { data, error } = await supabase.functions.invoke('admin-send-invitation', {
      body: { email: email.trim(), role, name: name.trim(), message: message.trim() },
    });
    setSending(false);
    if (error || data?.error) { toast.error(data?.error || 'Could not send the invitation'); return; }
    if (data?.sent === false) { toast.warning('This address has unsubscribed from our emails. Use another channel.'); return; }
    toast.success(`Invitation emailed to ${email.trim()}`);
    setEmail(''); setName(''); setMessage('');
  };

  const copy = async () => {
    await navigator.clipboard.writeText(shareText);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
    toast.success('Invitation copied');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite to AI Support 360</DialogTitle>
          <DialogDescription>Send a sign-up invitation by email or share it on any channel.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {([['consultant', Briefcase, 'Consultant'], ['client', Users, 'Customer']] as const).map(([v, Icon, l]) => (
            <button key={v} type="button" onClick={() => setRole(v)}
              className={cn('flex items-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors',
                role === v ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted/40')}>
              <Icon className="w-4 h-4" /> {l}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><Label className="text-xs">Name (optional)</Label><Input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Sara Ahmed" /></div>
            <div><Label className="text-xs">Email</Label><Input type="email" value={email} maxLength={254} onChange={e => setEmail(e.target.value)} placeholder="name@company.com" /></div>
          </div>
          <div><Label className="text-xs">Personal note (optional)</Label><Textarea rows={2} maxLength={500} value={message} onChange={e => setMessage(e.target.value)} placeholder="We'd love to have you on board." /></div>
          <Button className="w-full gradient-primary border-0" onClick={sendEmail} disabled={sending}>
            {sending ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <Mail className="w-4 h-4 me-1" />} Send email invitation
          </Button>
        </div>

        <div className="space-y-2 pt-2 border-t border-border/50">
          <p className="text-xs font-medium text-muted-foreground">Or share on</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {channels.map(c => (
              <a key={c.label} href={c.href} target="_blank" rel="noopener noreferrer"
                className="flex flex-col items-center gap-1 rounded-xl border border-border p-2 text-[11px] text-foreground hover:bg-muted/40">
                <c.icon className="w-4 h-4 text-primary" /> {c.label}
              </a>
            ))}
            <button type="button" onClick={copy} className="flex flex-col items-center gap-1 rounded-xl border border-border p-2 text-[11px] text-foreground hover:bg-muted/40">
              {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4 text-primary" />} Copy
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground break-all">Sign-up link: <span className="font-mono text-primary">{link}</span></p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
