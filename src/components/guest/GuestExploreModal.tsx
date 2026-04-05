import { useTranslation } from 'react-i18next';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Users, Briefcase, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GuestExploreModal({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const { enterGuestMode } = useGuestMode();
  const navigate = useNavigate();

  const roles = [
    {
      value: 'client' as const,
      icon: Users,
      title: t('guest.role_client'),
      desc: t('guest.role_client_desc'),
      path: '/client',
      color: 'text-blue-500',
      bg: 'bg-blue-500/10 border-blue-500/20',
    },
    {
      value: 'consultant' as const,
      icon: Briefcase,
      title: t('guest.role_consultant'),
      desc: t('guest.role_consultant_desc'),
      path: '/consultant',
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10 border-emerald-500/20',
    },
    {
      value: 'admin' as const,
      icon: Shield,
      title: t('guest.role_admin'),
      desc: t('guest.role_admin_desc'),
      path: '/admin',
      color: 'text-amber-500',
      bg: 'bg-amber-500/10 border-amber-500/20',
    },
  ];

  const handleSelect = (role: typeof roles[number]) => {
    enterGuestMode(role.value);
    onOpenChange(false);
    navigate(role.path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">{t('guest.modal_title')}</DialogTitle>
          <DialogDescription className="text-center">{t('guest.modal_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {roles.map((role) => (
            <button
              key={role.value}
              onClick={() => handleSelect(role)}
              className={cn(
                'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-start hover:scale-[1.02]',
                role.bg
              )}
            >
              <div className={cn('mt-0.5', role.color)}>
                <role.icon className="w-6 h-6" />
              </div>
              <div>
                <div className="font-semibold text-foreground">{role.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{role.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
