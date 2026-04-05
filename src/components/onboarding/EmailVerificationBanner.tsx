import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { MailWarning, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function EmailVerificationBanner() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (isGuest) return;
    const check = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // email_confirmed_at is null if not verified
      if (!user.email_confirmed_at) {
        setShow(true);
        setEmail(user.email || '');
      }
    };
    check();
  }, [isGuest]);

  const handleResend = async () => {
    setSending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
      });
      if (error) throw error;
      toast.success(t('email_verify.resent', 'Verification email sent! Check your inbox.'));
    } catch {
      toast.error(t('email_verify.resend_error', 'Failed to resend. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  if (!show) return null;

  return (
    <div className="relative rounded-2xl border border-yellow-300/50 bg-yellow-50/80 dark:bg-yellow-950/20 dark:border-yellow-800/40 p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center shrink-0">
        <MailWarning className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
          {t('email_verify.title', 'Verify your email address')}
        </h3>
        <p className="text-xs text-yellow-700/80 dark:text-yellow-400/70 mt-0.5">
          {t('email_verify.description', 'We sent a verification link to {{email}}. Please check your inbox and spam folder.').replace('{{email}}', email)}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={handleResend}
          disabled={sending}
          className="mt-2 h-7 text-xs border-yellow-400/50 text-yellow-700 hover:bg-yellow-100 dark:border-yellow-700 dark:text-yellow-300 dark:hover:bg-yellow-900/30 gap-1"
        >
          <Send className="w-3 h-3" />
          {sending ? t('common.loading', 'Sending...') : t('email_verify.resend', 'Resend verification email')}
        </Button>
      </div>
      <button
        onClick={() => setShow(false)}
        className="text-yellow-600/60 hover:text-yellow-700 dark:text-yellow-500/50 dark:hover:text-yellow-400 transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
