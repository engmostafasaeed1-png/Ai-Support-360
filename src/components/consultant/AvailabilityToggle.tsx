import { useSessionReady } from '@/hooks/useSessionReady';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Power, Loader2, Coffee } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';

type Status = 'available' | 'busy' | 'offline';

const META: Record<Status, { label: string; dot: string; ring: string; text: string; bg: string }> = {
  available: {
    label: 'Online',
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-400/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30',
  },
  busy: {
    label: 'Busy',
    dot: 'bg-amber-500',
    ring: 'ring-amber-400/40',
    text: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30',
  },
  offline: {
    label: 'Offline',
    dot: 'bg-slate-400',
    ring: 'ring-slate-300/40',
    text: 'text-slate-600 dark:text-slate-300',
    bg: 'bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700',
  },
};

interface Props {
  variant?: 'pill' | 'switch';
  className?: string;
}

export default function AvailabilityToggle({ variant = 'switch', className }: Props) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const signedIn = useSessionReady().signedIn;
  const { data: consultant, refetch } = useQuery({
    enabled: signedIn,
    queryKey: ['my-consultant-availability'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      // The session may still be restoring: answer "no consultant row"; useRefetchOnSignIn reloads this once signed in.
      if (!user) return null;
      const { data, error } = await supabase
        .from('consultants')
        .select('id, availability_status')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    retry: 3,
  });

  const [status, setStatus] = useState<Status>('offline');
  useEffect(() => {
    if (consultant?.availability_status) setStatus(consultant.availability_status as Status);
  }, [consultant?.availability_status]);

  const update = async (next: Status) => {
    if (saving || next === status) return;
    if (!consultant?.id) {
      const { data: fresh } = await refetch();
      if (!fresh?.id) {
        toast.error('Could not load your consultant profile. Please refresh the page.');
        return;
      }
      return updateWith(fresh.id, next);
    }
    return updateWith(consultant.id, next);
  };

  const updateWith = async (consultantId: string, next: Status) => {
    setSaving(true);
    const prev = status;
    setStatus(next);
    const { error } = await supabase
      .from('consultants')
      .update({ availability_status: next })
      .eq('id', consultantId);
    setSaving(false);
    if (error) {
      setStatus(prev);
      toast.error('Could not update availability');
      return;
    }
    toast.success(`You're now ${META[next].label.toLowerCase()}`);
    qc.invalidateQueries({ queryKey: ['my-consultant-availability'] });
    qc.invalidateQueries({ queryKey: ['consultant-dashboard'] });
  };

  const meta = META[status];
  const isOn = status === 'available';

  if (variant === 'pill') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all',
              meta.bg, meta.text, className
            )}
          >
            <span className={cn('w-2 h-2 rounded-full', meta.dot, isOn && 'animate-pulse')} />
            {meta.label}
          </button>
        </DropdownMenuTrigger>
        <StatusMenu status={status} onSelect={update} />
      </DropdownMenu>
    );
  }

  // Uber-style big toggle
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Toggle availability"
          disabled={saving}
          className={cn(
            'group relative inline-flex items-center gap-3 pl-1.5 pr-4 py-1.5 rounded-full border-2 shadow-sm hover:shadow-md transition-all',
            meta.bg,
            className
          )}
        >
          {/* Knob */}
          <span
            className={cn(
              'relative w-9 h-9 rounded-full flex items-center justify-center shadow-md ring-4 transition-all',
              meta.dot, meta.ring,
              isOn ? 'translate-x-0' : 'translate-x-0'
            )}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Power className={cn('w-4 h-4 text-white', isOn && 'drop-shadow')} strokeWidth={2.75} />
            )}
            {isOn && (
              <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" />
            )}
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span className={cn('text-[10px] uppercase tracking-wider font-bold', meta.text, 'opacity-70')}>
              You're
            </span>
            <span className={cn('text-sm font-extrabold', meta.text)}>
              {meta.label}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <StatusMenu status={status} onSelect={update} />
    </DropdownMenu>
  );
}

function StatusMenu({ status, onSelect }: { status: Status; onSelect: (s: Status) => void }) {
  const Item = ({ s, icon, hint }: { s: Status; icon: React.ReactNode; hint: string }) => (
    <DropdownMenuItem
      onClick={() => onSelect(s)}
      className={cn('flex items-start gap-3 py-2.5 cursor-pointer', status === s && 'bg-accent/40')}
    >
      <span className={cn('w-8 h-8 rounded-full flex items-center justify-center shrink-0', META[s].dot)}>
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-semibold">{META[s].label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenuContent align="end" className="w-64 rounded-2xl p-2">
      <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
        Set your availability
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <Item s="available" icon={<Power className="w-4 h-4 text-white" strokeWidth={2.75} />} hint="Go online — receive new requests (stays until you change it)" />
      <Item s="busy" icon={<Coffee className="w-4 h-4 text-white" strokeWidth={2.5} />} hint="On a session — clients see you as busy" />
      <Item s="offline" icon={<Power className="w-4 h-4 text-white" strokeWidth={2.75} />} hint="Stop receiving requests" />
    </DropdownMenuContent>
  );
}
