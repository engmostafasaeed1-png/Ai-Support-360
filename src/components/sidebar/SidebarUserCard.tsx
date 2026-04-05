import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  collapsed: boolean;
}

export default function SidebarUserCard({ collapsed }: Props) {
  const { profile, loading } = useUserProfile();

  if (loading) {
    return (
      <div className="flex items-center gap-2.5 p-3 rounded-xl">
        <Skeleton className="w-9 h-9 rounded-full bg-sidebar-accent" />
        {!collapsed && <div className="space-y-1.5"><Skeleton className="h-3 w-20 bg-sidebar-accent" /><Skeleton className="h-2.5 w-28 bg-sidebar-accent" /></div>}
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="flex items-center gap-2.5 p-3 rounded-xl bg-sidebar-accent/30">
      <Avatar className="w-9 h-9 shrink-0">
        {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.displayName} />}
        <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs font-semibold">
          {profile.initials}
        </AvatarFallback>
      </Avatar>
      {!collapsed && (
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sidebar-foreground truncate">{profile.displayName}</p>
          <p className="text-[10px] text-sidebar-foreground/50 truncate">{profile.email}</p>
        </div>
      )}
    </div>
  );
}
