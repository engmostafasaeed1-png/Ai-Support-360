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
  { key: 'satisfaction', icon: CheckCircle2, path: '/client/satisfaction' },
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
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive = item.path === '/consultant'
                  ? location.pathname === '/consultant'
                  : location.pathname.startsWith(item.path);
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.path}
                        end={item.path === '/consultant'}
                        className={`hover:bg-sidebar-accent/50 ${isActive ? 'bg-sidebar-accent text-sidebar-primary font-medium' : ''}`}
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        {item.key === 'onboarding' && onboardingDone ? (
                          <CheckCircle2 className="w-4 h-4 me-2 shrink-0 text-green-500" />
                        ) : (
                          <item.icon className="w-4 h-4 me-2 shrink-0" />
                        )}
                        {!collapsed && (
                          <span className="flex items-center gap-2">
                            {item.key === 'onboarding' && onboardingDone ? t('sidebar.onboarding_complete', 'Onboarding') : t(`sidebar.${item.key}`)}
                            {item.key === 'onboarding' && onboardingDone && (
                              <span className="text-[10px] font-medium bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded-full">{t('sidebar.completed', 'Done')}</span>
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

        <div className="mt-auto p-4 border-t border-sidebar-border space-y-3">
          <SidebarUserCard collapsed={collapsed} onClick={() => setProfileOpen(true)} />
          {!collapsed && (
            <div className="space-y-2">
              <button
                onClick={toggleLanguage}
                className="flex items-center gap-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
              >
                <Globe className="w-3.5 h-3.5" />
                {currentLang === 'en' ? 'العربية' : 'English'}
              </button>
              <button
                onClick={logout}
                className="flex items-center gap-2 text-xs text-destructive hover:text-destructive/80 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
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
