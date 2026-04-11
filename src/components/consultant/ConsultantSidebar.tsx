import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '@/hooks/useLanguage';
import SidebarUserCard from '@/components/sidebar/SidebarUserCard';
import { useLogout } from '@/hooks/useLogout';
import { NavLink } from '@/components/NavLink';
import { useLocation, Link } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import {
  Gauge, Headset, CalendarClock, Wallet, StarHalf,
  UserCircle, Fingerprint, BookOpenCheck, BellRing, SlidersHorizontal, Globe, MessagesSquare, LogOut, Rocket, CheckCircle2, MonitorSmartphone, Inbox, PartyPopper, Receipt, Timer, ShoppingBag, PieChart, VideoIcon, Workflow,
} from 'lucide-react';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { supabase } from '@/integrations/supabase/client';
import ProfileEditDialog from '@/components/profile/ProfileEditDialog';
import logo from '@/assets/logo.png';

const menuItems = [
  { key: 'dashboard', icon: Gauge, path: '/consultant' },
  { key: 'onboarding', icon: Rocket, path: '/consultant/onboarding' },
  { key: 'cases', icon: Headset, path: '/consultant/cases' },
  { key: 'requests', icon: Inbox, path: '/consultant/requests' },
  { key: 'proposals', icon: Receipt, path: '/consultant/proposals' },
  { key: 'open_tickets', icon: ShoppingBag, path: '/consultant/open-tickets' },
  { key: 'work_diary', icon: Timer, path: '/consultant/work-diary' },
  { key: 'calendar', icon: CalendarClock, path: '/consultant/calendar' },
  { key: 'earnings', icon: Wallet, path: '/consultant/earnings' },
  { key: 'chat', icon: MessagesSquare, path: '/consultant/chat' },
  { key: 'reviews', icon: StarHalf, path: '/consultant/reviews' },
  { key: 'profile', icon: UserCircle, path: '/consultant/profile' },
  { key: 'interviews', icon: VideoIcon, path: '/consultant/interviews' },
  { key: 'verification', icon: Fingerprint, path: '/consultant/verification' },
  { key: 'remote_access', icon: MonitorSmartphone, path: '/consultant/remote-access' },
  { key: 'knowledge', icon: BookOpenCheck, path: '/consultant/knowledge' },
  { key: 'business_processes', icon: Workflow, path: '/consultant/business-processes' },
  { key: 'satisfaction', icon: CheckCircle2, path: '/consultant/satisfaction' },
  { key: 'reports', icon: PieChart, path: '/consultant/reports' },
  { key: 'referrals', icon: PartyPopper, path: '/consultant/referrals' },
  { key: 'notifications', icon: BellRing, path: '/consultant/notifications' },
  { key: 'settings', icon: SlidersHorizontal, path: '/consultant/settings' },
];


export default function ConsultantSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { toggleLanguage, currentLang } = useLanguage();
  const { t } = useTranslation();
  const logout = useLogout();
  const { isGuest } = useGuestMode();
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    if (isGuest) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      supabase.from('profiles').select('onboarding_completed').eq('user_id', session.user.id).maybeSingle()
        .then(({ data }) => { if (data?.onboarding_completed) setOnboardingDone(true); });
    });
  }, [isGuest]);

  const visibleItems = menuItems;

  return (
    <>
    <Sidebar collapsible="icon" className="border-e border-border/50">
      <SidebarContent className="bg-sidebar text-sidebar-foreground">
        <div className="p-3 flex items-center justify-center border-b border-sidebar-border/30">
          <Link to="/" className="group">
            <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-sm group-hover:shadow-md transition-shadow">
              <img src={logo} alt="Logo" width={40} height={40} className="w-full h-full object-contain" />
            </div>
          </Link>
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="space-y-1 px-2">
              {visibleItems.map((item) => {
                const isActive = item.path === '/consultant'
                  ? location.pathname === '/consultant'
                  : location.pathname.startsWith(item.path);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild className="h-auto p-0">
                      <NavLink
                        to={item.path}
                        end={item.path === '/consultant'}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                          isActive
                            ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/20'
                            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground hover:shadow-sm'
                        }`}
                        activeClassName=""
                      >
                        <div className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-colors ${
                          isActive
                            ? 'bg-white/20'
                            : 'bg-sidebar-accent/40'
                        }`}>
                          {item.key === 'onboarding' && onboardingDone ? (
                            <CheckCircle2 className="w-4.5 h-4.5 text-green-400" />
                          ) : (
                            <item.icon className="w-4.5 h-4.5" />
                          )}
                        </div>
                        {!collapsed && (
                          <span className="flex items-center gap-2 truncate">
                            {item.key === 'onboarding' && onboardingDone ? t('sidebar.onboarding_complete', 'Onboarding') : t(`sidebar.${item.key}`)}
                            {item.key === 'onboarding' && onboardingDone && (
                              <span className="text-[10px] font-semibold bg-green-500/20 text-green-300 px-1.5 py-0.5 rounded-full">{t('sidebar.completed', 'Done')}</span>
                            )}
                          </span>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mt-auto p-3 border-t border-sidebar-border/30 space-y-2">
          <SidebarUserCard collapsed={collapsed} onClick={() => setProfileOpen(true)} />
          {!collapsed && (
            <div className="space-y-1 px-1">
              <button
                onClick={toggleLanguage}
                className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground transition-all"
              >
                <Globe className="w-4 h-4" />
                {currentLang === 'en' ? 'العربية' : 'English'}
              </button>
              <button
                onClick={logout}
                className="flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-all"
              >
                <LogOut className="w-4 h-4" />
                {t('sidebar.logout')}
              </button>
            </div>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
    <ProfileEditDialog open={profileOpen} onOpenChange={setProfileOpen} role="consultant" />
    </>
  );
}
