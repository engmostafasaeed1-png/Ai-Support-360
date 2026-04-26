import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from '@/components/NavLink';
import SidebarUserCard from '@/components/sidebar/SidebarUserCard';
import { useLocation, Link } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import {
  Gauge, Headset, CalendarClock, Wallet, StarHalf, UserCircle, Fingerprint,
  BookOpenCheck, BellRing, SlidersHorizontal, Globe, MessagesSquare, LogOut,
  Rocket, CheckCircle2, MonitorSmartphone, Inbox, PartyPopper, Receipt, Timer,
  ShoppingBag, PieChart, VideoIcon, Workflow, Sparkles,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useLogout } from '@/hooks/useLogout';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { supabase } from '@/integrations/supabase/client';
import { useScreenPreferences } from '@/hooks/useScreenPreferences';
import ScreenPersonalizationDialog from '@/components/sidebar/ScreenPersonalizationDialog';
import ProfileEditDialog from '@/components/profile/ProfileEditDialog';
import logo from '@/assets/logo.png';
import sidebarBanner from '@/assets/sidebar-banner.png';
import TileTooltip from '@/components/sidebar/TileTooltip';
import { getTileMeta } from '@/components/sidebar/tileMeta';
import SidebarTileSkeleton from '@/components/sidebar/SidebarTileSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { useTileDensity } from '@/hooks/useTileDensity';
import { mobileTileDensityClasses } from '@/components/sidebar/tileDensityClasses';

// Per-tile color tints — mirrors ClientSidebar style
const tileTints: Record<string, string> = {
  dashboard: 'from-blue-500/25 to-blue-500/5 text-blue-500',
  onboarding: 'from-amber-500/25 to-amber-500/5 text-amber-500',
  cases: 'from-rose-500/25 to-rose-500/5 text-rose-500',
  requests: 'from-violet-500/25 to-violet-500/5 text-violet-500',
  proposals: 'from-cyan-500/25 to-cyan-500/5 text-cyan-500',
  open_tickets: 'from-orange-500/25 to-orange-500/5 text-orange-500',
  work_diary: 'from-indigo-500/25 to-indigo-500/5 text-indigo-500',
  calendar: 'from-pink-500/25 to-pink-500/5 text-pink-500',
  earnings: 'from-emerald-500/25 to-emerald-500/5 text-emerald-500',
  chat: 'from-sky-500/25 to-sky-500/5 text-sky-500',
  reviews: 'from-yellow-500/25 to-yellow-500/5 text-yellow-600',
  interviews: 'from-fuchsia-500/25 to-fuchsia-500/5 text-fuchsia-500',
  credits: 'from-amber-500/25 to-amber-500/5 text-amber-500',
  profile: 'from-purple-500/25 to-purple-500/5 text-purple-500',
  verification: 'from-emerald-500/25 to-emerald-500/5 text-emerald-500',
  remote_access: 'from-blue-500/25 to-blue-500/5 text-blue-500',
  knowledge: 'from-amber-500/25 to-amber-500/5 text-amber-500',
  business_processes: 'from-teal-500/25 to-teal-500/5 text-teal-500',
  satisfaction: 'from-yellow-500/25 to-yellow-500/5 text-yellow-500',
  reports: 'from-indigo-500/25 to-indigo-500/5 text-indigo-500',
  referrals: 'from-pink-500/25 to-pink-500/5 text-pink-500',
  notifications: 'from-amber-500/25 to-amber-500/5 text-amber-500',
  settings: 'from-slate-500/25 to-slate-500/5 text-slate-500',
};

const titleize = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const navGroups = [
  {
    labelKey: 'sidebar.overview',
    fallback: 'Overview',
    items: [
      { key: 'dashboard', icon: Gauge, path: '/consultant', required: true },
      { key: 'onboarding', icon: Rocket, path: '/consultant/onboarding' },
    ],
  },
  {
    labelKey: 'sidebar.work',
    fallback: 'Work',
    items: [
      { key: 'cases', icon: Headset, path: '/consultant/cases' },
      { key: 'requests', icon: Inbox, path: '/consultant/requests' },
      { key: 'proposals', icon: Receipt, path: '/consultant/proposals' },
      { key: 'open_tickets', icon: ShoppingBag, path: '/consultant/open-tickets' },
      { key: 'work_diary', icon: Timer, path: '/consultant/work-diary' },
      { key: 'calendar', icon: CalendarClock, path: '/consultant/calendar' },
      { key: 'chat', icon: MessagesSquare, path: '/consultant/chat' },
      { key: 'business_processes', icon: Workflow, path: '/consultant/business-processes' },
    ],
  },
  {
    labelKey: 'sidebar.finance',
    fallback: 'Finance',
    items: [
      { key: 'earnings', icon: Wallet, path: '/consultant/earnings' },
      { key: 'credits', icon: Sparkles, path: '/consultant/credits' },
    ],
  },
  {
    labelKey: 'sidebar.tools',
    fallback: 'Tools',
    items: [
      { key: 'interviews', icon: VideoIcon, path: '/consultant/interviews' },
      { key: 'remote_access', icon: MonitorSmartphone, path: '/consultant/remote-access' },
      { key: 'knowledge', icon: BookOpenCheck, path: '/consultant/knowledge' },
      { key: 'reviews', icon: StarHalf, path: '/consultant/reviews' },
      { key: 'satisfaction', icon: CheckCircle2, path: '/consultant/satisfaction' },
      { key: 'referrals', icon: PartyPopper, path: '/consultant/referrals' },
    ],
  },
  {
    labelKey: 'sidebar.management',
    fallback: 'Management',
    items: [
      { key: 'reports', icon: PieChart, path: '/consultant/reports' },
    ],
  },
  {
    labelKey: 'sidebar.account',
    fallback: 'Account',
    items: [
      { key: 'profile', icon: UserCircle, path: '/consultant/profile' },
      { key: 'verification', icon: Fingerprint, path: '/consultant/verification' },
      { key: 'notifications', icon: BellRing, path: '/consultant/notifications' },
      { key: 'settings', icon: SlidersHorizontal, path: '/consultant/settings' },
    ],
  },
];

const allScreens = navGroups.flatMap(g =>
  g.items.map(item => ({
    key: item.key,
    label: item.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: item.icon,
    group: g.labelKey.split('.')[1]?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'General',
    required: (item as { required?: boolean }).required || false,
  }))
);

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
  const { hiddenScreens, toggleScreen, resetAll, isVisible, loading: prefsLoading } = useScreenPreferences(allScreens);
  const { density } = useTileDensity();
  const dens = mobileTileDensityClasses[density];

  useEffect(() => {
    if (isGuest) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      supabase.from('profiles').select('onboarding_completed').eq('user_id', session.user.id).maybeSingle()
        .then(({ data }) => { if (data?.onboarding_completed) setOnboardingDone(true); });
    });
  }, [isGuest]);

  const allNavPaths = navGroups.flatMap(g => g.items.map(i => i.path));
  const bestMatchPath = (() => {
    const path = location.pathname;
    let best = '';
    for (const p of allNavPaths) {
      if (p === '/consultant') {
        if (path === '/consultant' && best === '') best = p;
        continue;
      }
      if (path === p || path.startsWith(p + '/')) {
        if (p.length > best.length) best = p;
      }
    }
    return best;
  })();

  return (
    <>
    <Sidebar collapsible="icon" className="border-e border-border/30">
      <SidebarContent className="bg-sidebar text-sidebar-foreground flex flex-col">
        {/* Logo banner */}
        <div className={`bg-white border-b border-slate-200 shadow-sm ${collapsed ? 'p-3' : 'px-4 py-3'} flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <Link to="/" className="group flex items-center gap-3 min-w-0">
            <div className={`${collapsed ? 'w-10 h-10' : 'w-12 h-12'} rounded-xl overflow-hidden shrink-0 bg-white ring-1 ring-slate-200 shadow-sm group-hover:shadow-md transition-shadow flex items-center justify-center`}>
              <img src={logo} alt="AI SAP Support Now" width={collapsed ? 40 : 48} height={collapsed ? 40 : 48} className="w-full h-full object-contain p-0.5" />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-bold text-slate-900 leading-tight truncate">AI SAP Support Now</span>
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Consultant Portal</span>
              </div>
            )}
          </Link>
        </div>

        {/* Navigation Groups - Modern Tile Grid */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4">
          {prefsLoading ? (
            <div className="space-y-4">
              {[8, 6].map((tilesInGroup, gi) => (
                <div key={gi} className="space-y-2">
                  {!collapsed && (
                    <div className="px-4 mb-1.5">
                      <Skeleton className="h-2.5 w-20 rounded-full bg-sidebar-accent/40" />
                    </div>
                  )}
                  <SidebarTileSkeleton count={tilesInGroup} collapsed={collapsed} />
                </div>
              ))}
            </div>
          ) : navGroups.map((group) => {
            const visibleItems = group.items.filter(item => isVisible(item.key));
            if (visibleItems.length === 0) return null;
            return (
              <SidebarGroup key={group.labelKey}>
                {!collapsed && (
                  <SidebarGroupLabel className="px-4 text-[10px] uppercase tracking-wider font-semibold text-sidebar-foreground/40 mb-1.5">
                    {String(t(group.labelKey, { defaultValue: group.fallback }))}
                  </SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  {collapsed ? (
                    <SidebarMenu>
                      {visibleItems.map((item) => {
                        const isActive = item.path === bestMatchPath;
                        const label = String(t(`sidebar.${item.key}`, { defaultValue: titleize(item.key) }));
                        const tint = tileTints[item.key] || 'from-primary/20 to-primary/5 text-primary';
                        const isOnboardingDone = item.key === 'onboarding' && onboardingDone;
                        return (
                          <SidebarMenuItem key={item.key}>
                            <SidebarMenuButton asChild>
                              <TileTooltip scope="consultant" itemKey={item.key} label={label} isActive={isActive} side="right">
                                <NavLink
                                  to={item.path}
                                  end={item.path === '/consultant'}
                                  aria-label={`${label}. ${getTileMeta('consultant', item.key, label).description}`}
                                  aria-current={isActive ? 'page' : undefined}
                                  className={`group/item relative flex items-center justify-center rounded-xl mx-1.5 my-0.5 h-10 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
                                    isActive
                                      ? `bg-gradient-to-br ${tint} shadow-lg`
                                      : 'hover:bg-sidebar-accent/60 text-sidebar-foreground/70 hover:text-sidebar-foreground'
                                  }`}
                                  activeClassName=""
                                >
                                  {isOnboardingDone ? (
                                    <CheckCircle2 aria-hidden="true" focusable="false" className="w-4 h-4 shrink-0 text-green-500" />
                                  ) : (
                                    <item.icon aria-hidden="true" focusable="false" className="w-4 h-4 shrink-0" />
                                  )}
                                </NavLink>
                              </TileTooltip>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3">
                      {visibleItems.map((item) => {
                        const isActive = item.path === bestMatchPath;
                        const isOnboardingDone = item.key === 'onboarding' && onboardingDone;
                        const label = isOnboardingDone
                          ? String(t('sidebar.onboarding_complete', { defaultValue: 'Onboarding' }))
                          : String(t(`sidebar.${item.key}`, { defaultValue: titleize(item.key) }));
                        const tint = tileTints[item.key] || 'from-primary/20 to-primary/5 text-primary';
                        return (
                          <TileTooltip key={item.key} scope="consultant" itemKey={item.key} label={label} isActive={isActive} side="right">
                            <NavLink
                              to={item.path}
                              end={item.path === '/consultant'}
                              aria-label={`${label}${isOnboardingDone ? ' (completed)' : ''}. ${getTileMeta('consultant', item.key, label).description}`}
                              aria-current={isActive ? 'page' : undefined}
                              className={`group/tile relative flex flex-row sm:flex-col items-center sm:items-center justify-start sm:justify-center ${dens.row} sm:gap-2 rounded-2xl sm:px-2 sm:py-3.5 sm:min-h-0 text-start sm:text-center transition-all duration-200 overflow-hidden border outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
                                isActive
                                  ? 'bg-gradient-to-br from-primary via-primary/85 to-primary/60 text-primary-foreground border-primary/50 shadow-xl shadow-primary/40 sm:scale-[1.03]'
                                  : 'bg-sidebar-accent/15 hover:bg-sidebar-accent/40 text-sidebar-foreground/90 hover:text-sidebar-foreground border-sidebar-border/30 hover:border-sidebar-border/70 hover:shadow-md hover:-translate-y-0.5'
                              }`}
                              activeClassName=""
                            >
                              {isActive && (
                                <>
                                  <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/15 to-white/0 pointer-events-none" />
                                  <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full bg-white/20 blur-2xl pointer-events-none" />
                                </>
                              )}
                              <div aria-hidden="true" className={`flex items-center justify-center ${dens.iconBox} sm:w-11 sm:h-11 rounded-2xl shrink-0 transition-all ${
                                isActive
                                  ? 'bg-white/25 backdrop-blur-sm shadow-inner'
                                  : `bg-gradient-to-br ${tint} group-hover/tile:scale-110 shadow-sm`
                              }`}>
                                {isOnboardingDone ? (
                                  <CheckCircle2 aria-hidden="true" focusable="false" className={`w-5 h-5 ${isActive ? 'text-primary-foreground drop-shadow' : 'text-green-500'}`} strokeWidth={2.4} />
                                ) : (
                                  <item.icon aria-hidden="true" focusable="false" className={`w-5 h-5 ${isActive ? 'text-primary-foreground drop-shadow' : ''}`} strokeWidth={2.2} />
                                )}
                              </div>
                              <span className={`flex-1 sm:flex-none ${dens.label} sm:text-[11px] font-semibold leading-tight whitespace-normal break-words sm:line-clamp-2 ${isActive ? 'text-primary-foreground' : 'text-sidebar-foreground/85 group-hover/tile:text-sidebar-foreground'}`}>
                                {label}
                              </span>
                            </NavLink>
                          </TileTooltip>
                        );
                      })}
                    </div>
                  )}
                </SidebarGroupContent>
              </SidebarGroup>
            );
          })}
        </div>

        {/* Banner CTA */}
        {!collapsed && (
          <div className="mx-3 mb-2">
            <div className="relative rounded-xl overflow-hidden">
              <img src={sidebarBanner} alt="" loading="lazy" width={800} height={512} className="w-full h-20 object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-primary/90 to-primary/60 flex items-center px-3">
                <div>
                  <p className="text-[11px] font-bold text-primary-foreground leading-tight">Boost Your Earnings</p>
                  <p className="text-[9px] text-primary-foreground/70 mt-0.5">Find new opportunities</p>
                </div>
                <Link to="/consultant/open-tickets" className="ms-auto bg-white/20 hover:bg-white/30 text-primary-foreground text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors backdrop-blur-sm">
                  Browse
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-3 border-t border-sidebar-border/30 space-y-2.5">
          <SidebarUserCard collapsed={collapsed} onClick={() => setProfileOpen(true)} />
          {!collapsed && (
            <div className="space-y-1">
              <ScreenPersonalizationDialog
                screens={allScreens}
                hiddenScreens={hiddenScreens}
                onToggle={toggleScreen}
                onResetAll={resetAll}
                collapsed={collapsed}
              />
              <div className="flex items-center gap-3 px-1">
                <button
                  onClick={toggleLanguage}
                  className="flex items-center gap-1.5 text-[11px] text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
                >
                  <Globe className="w-3.5 h-3.5" />
                  {currentLang === 'en' ? 'AR' : 'EN'}
                </button>
                <div className="w-px h-3 bg-sidebar-border/50" />
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 text-[11px] text-destructive/70 hover:text-destructive transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t('sidebar.logout')}
                </button>
              </div>
            </div>
          )}
        </div>
      </SidebarContent>
    </Sidebar>
    <ProfileEditDialog open={profileOpen} onOpenChange={setProfileOpen} role="consultant" />
    </>
  );
}
