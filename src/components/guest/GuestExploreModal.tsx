import { useGuestMode } from '@/contexts/GuestModeContext';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Users, Briefcase, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const roles = [
  {
    value: 'client' as const,
    icon: Users,
    title: 'Client Dashboard',
    desc: 'Browse consultants, submit tickets, book sessions, and manage payments.',
    path: '/client',
    color: 'text-blue-500',
    bg: 'bg-blue-500/10 border-blue-500/20',
  },
  {
    value: 'consultant' as const,
    icon: Briefcase,
    title: 'Consultant Dashboard',
    desc: 'View cases, manage calendar, track earnings, and handle profile.',
    path: '/consultant',
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  {
    value: 'admin' as const,
    icon: Shield,
    title: 'Admin Dashboard',
    desc: 'Manage users, approve consultants, view analytics, and handle tickets.',
    path: '/admin',
    color: 'text-amber-500',
    bg: 'bg-amber-500/10 border-amber-500/20',
  },
];

export default function GuestExploreModal({ open, onOpenChange }: Props) {
  const { enterGuestMode } = useGuestMode();
  const navigate = useNavigate();

  const handleSelect = (role: typeof roles[number]) => {
    enterGuestMode(role.value);
    onOpenChange(false);
    navigate(role.path);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">Explore as Guest</DialogTitle>
          <DialogDescription className="text-center">
            Choose a role to explore all features with sample data — no sign-up required.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {roles.map((role) => (
            <button
              key={role.value}
              onClick={() => handleSelect(role)}
              className={cn(
                'w-full flex items-start gap-4 p-4 rounded-xl border-2 transition-all text-left hover:scale-[1.02]',
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
