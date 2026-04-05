import { useGuestMode } from '@/contexts/GuestModeContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Eye, LogIn, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function GuestBanner() {
  const { isGuest, guestRole, exitGuestMode } = useGuestMode();
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (!isGuest) return null;

  const roleLabels: Record<string, string> = {
    client: t('auth.role_client', 'Client'),
    consultant: t('auth.role_consultant', 'Consultant'),
    admin: 'Admin',
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-5 py-3 rounded-2xl bg-accent/95 text-accent-foreground shadow-lg backdrop-blur-md border border-accent/20 animate-fade-in">
      <Eye className="w-4 h-4 shrink-0" />
      <span className="text-sm font-medium">
        Guest Mode — {roleLabels[guestRole || 'client']} View
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
        Sign Up
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
