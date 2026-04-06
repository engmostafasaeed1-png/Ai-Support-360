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
  LayoutDashboard, Briefcase, Calendar, CreditCard, Star,
  User, ShieldCheck, BookOpen, Bell, Settings, Globe, MessageSquare, LogOut, ClipboardList, CheckCircle2, Server, Handshake, Gift, FileText, Clock,
} from 'lucide-react';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { supabase } from '@/integrations/supabase/client';

const menuItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/consultant' },
  { key: 'onboarding', icon: ClipboardList, path: '/consultant/onboarding' },
  { key: 'cases', icon: Briefcase, path: '/consultant/cases' },
  { key: 'requests', icon: Handshake, path: '/consultant/requests' },
  { key: 'proposals', icon: FileText, path: '/consultant/proposals' },
  { key: 'work_diary', icon: Clock, path: '/consultant/work-diary' },
  { key: 'calendar', icon: Calendar, path: '/consultant/calendar' },
  { key: 'earnings', icon: CreditCard, path: '/consultant/earnings' },
  { key: 'chat', icon: MessageSquare, path: '/consultant/chat' },
  { key: 'reviews', icon: Star, path: '/consultant/reviews' },
  { key: 'profile', icon: User, path: '/consultant/profile' },
  { key: 'verification', icon: ShieldCheck, path: '/consultant/verification' },
  { key: 'remote_access', icon: Server, path: '/consultant/remote-access' },
  { key: 'knowledge', icon: BookOpen, path: '/consultant/knowledge' },
  { key: 'referrals', icon: Gift, path: '/consultant/referrals' },
  { key: 'notifications', icon: Bell, path: '/consultant/notifications' },
  { key: 'settings', icon: Settings, path: '/consultant/settings' },
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
    <Sidebar collapsible="icon" className="border-e border-border/50">
      <SidebarContent className="bg-sidebar text-sidebar-foreground">
        <div className="p-4 flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary-foreground">Q</span>
            </div>
            {!collapsed && <span className="font-bold text-sm text-sidebar-foreground">{t('sidebar.consultant_portal')}</span>}
          </Link>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50">{t('sidebar.menu')}</SidebarGroupLabel>
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
          <SidebarUserCard collapsed={collapsed} />
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
  );
}
