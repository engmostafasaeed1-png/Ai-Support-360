import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown, Globe, LogOut, Repeat, SlidersHorizontal, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useLanguage } from '@/hooks/useLanguage';
import { useLogout } from '@/hooks/useLogout';
import { useUserProfile } from '@/hooks/useUserProfile';
import { cn } from '@/lib/utils';

interface SidebarAccountMenuProps {
  collapsed: boolean;
  /** Omit for portals that have no profile editor (admin, super admin). */
  onEditProfile?: () => void;
  onCustomize: () => void;
}

/** One footer entry that replaces the old user card + personalize + language + logout stack. */
export default function SidebarAccountMenu({ collapsed, onEditProfile, onCustomize }: SidebarAccountMenuProps) {
  const { t } = useTranslation();
  const { profile, loading } = useUserProfile();
  const { isGuest } = useGuestMode();
  const { currentLang, toggleLanguage } = useLanguage();
  const logout = useLogout();
  const navigate = useNavigate();
  const { data: roles = [] } = useQuery({
    queryKey: ['my-roles'],
    queryFn: async (): Promise<string[]> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id);
      return (data ?? []).map((r: any) => String(r.role));
    },
    staleTime: 5 * 60 * 1000,
  });
  // Only shortcuts; each portal still checks the role on entry and in the database.
  const portals = [
    { role: 'client', path: '/client', label: String(t('sidebar.portal_client_switch', { defaultValue: 'Client portal' })) },
    { role: 'consultant', path: '/consultant', label: String(t('sidebar.portal_consultant_switch', { defaultValue: 'Consultant portal' })) },
    { role: 'admin', path: '/admin', label: String(t('sidebar.portal_admin_switch', { defaultValue: 'Admin console' })) },
    { role: 'super_admin', path: '/super-admin', label: String(t('sidebar.portal_super_switch', { defaultValue: 'Super admin' })) },
  ].filter((p) => roles.includes(p.role));
  // Set when a menu item opens a dialog, so the menu does not hand focus back to its trigger.
  const openingDialog = useRef(false);

  if (loading) {
    return (
      <div className={cn('flex items-center gap-3 p-1.5', collapsed && 'justify-center p-0')}>
        <Skeleton className="h-8 w-8 shrink-0 rounded-full bg-sidebar-accent" />
        {!collapsed && (
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24 bg-sidebar-accent" />
            <Skeleton className="h-2.5 w-32 bg-sidebar-accent" />
          </div>
        )}
      </div>
    );
  }

  const name = isGuest
    ? String(t('sidebar.guest', { defaultValue: 'Guest' }))
    : profile?.displayName ?? String(t('sidebar.account_menu', { defaultValue: 'Account' }));
  const initials = isGuest ? 'G' : profile?.initials || 'U';
  const email = isGuest ? '' : profile?.email ?? '';

  const openDialog = (open: () => void) => () => {
    openingDialog.current = true;
    open();
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={String(t('sidebar.account_menu', { defaultValue: 'Account' }))}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg p-1.5 text-start outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent/60',
            collapsed && 'justify-center p-0',
          )}
        >
          <Avatar className="h-8 w-8 shrink-0">
            {!isGuest && profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt="" />}
            <AvatarFallback className="bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-medium text-sidebar-foreground">{name}</span>
                {email && <span className="block truncate text-[11px] text-sidebar-foreground/60">{email}</span>}
              </span>
              <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-sidebar-foreground/50" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={collapsed ? 'right' : 'top'}
        align={collapsed ? 'end' : 'start'}
        sideOffset={8}
        className="w-60"
        onCloseAutoFocus={(e) => {
          if (openingDialog.current) {
            e.preventDefault();
            openingDialog.current = false;
          }
        }}
      >
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{name}</p>
          {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {onEditProfile && !isGuest && (
          <DropdownMenuItem onSelect={openDialog(onEditProfile)}>
            <User aria-hidden="true" className="me-2 h-4 w-4" />
            {String(t('sidebar.edit_profile', { defaultValue: 'Edit profile' }))}
          </DropdownMenuItem>
        )}
        {portals.length > 1 && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {String(t('sidebar.switch_portal', { defaultValue: 'Switch portal' }))}
            </DropdownMenuLabel>
            {portals.map((p) => (
              <DropdownMenuItem key={p.path} onSelect={() => navigate(p.path)}>
                <Repeat aria-hidden="true" className="me-2 h-4 w-4" />
                {p.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={openDialog(onCustomize)}>
          <SlidersHorizontal aria-hidden="true" className="me-2 h-4 w-4" />
          {String(t('sidebar.personalize', { defaultValue: 'Customize menu' }))}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleLanguage}>
          <Globe aria-hidden="true" className="me-2 h-4 w-4" />
          {currentLang === 'en' ? 'العربية' : 'English'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void logout()}
          className="text-red-600 focus:bg-red-500/10 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
        >
          <LogOut aria-hidden="true" className="me-2 h-4 w-4" />
          {String(t('sidebar.logout', { defaultValue: 'Sign out' }))}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
