import { useTranslation } from 'react-i18next';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Eye, LogIn, X } from 'lucide-react';

export default function GuestBanner() {
  const { t } = useTranslation();
  const { isGuest, guestRole, exitGuestMode } = useGuestMode();
  const navigate = useNavigate();

  if (!isGuest) return null;

  const roleLabels: Record<string, string> = {
    client: t('guest.role_client'),
    consultant: t('guest.role_consultant'),
    admin: t('guest.role_admin'),
  };

  return (
    <div className="fixed bottom-[4.5rem] md:bottom-4 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[60] flex items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 sm:py-3 rounded-2xl bg-accent/95 text-accent-foreground shadow-lg backdrop-blur-md border border-accent/20 animate-fade-in">
      <Eye className="w-4 h-4 shrink-0" />
      <span className="text-xs sm:text-sm font-medium truncate">
        {t('guest.banner_label')} — {roleLabels[guestRole || 'client']} {t('guest.banner_view')}
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 text-xs"
        onClick={() => {
          exitGuestMode();
          navigate('/signup');
        }}
      >
        <LogIn className="w-3 h-3 me-1" />
        {t('guest.signup_btn')}
      </Button>
      <button
        onClick={() => {
          exitGuestMode();
          navigate('/');
        }}
        className="text-accent-foreground/70 hover:text-accent-foreground"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
