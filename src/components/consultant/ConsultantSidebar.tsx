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
import { useScreenPreferences } from '@/hooks/useScreenPreferences';
import ScreenPersonalizationDialog from '@/components/sidebar/ScreenPersonalizationDialog';
import ProfileEditDialog from '@/components/profile/ProfileEditDialog';
import logo from '@/assets/logo.png';
import TileTooltip from '@/components/sidebar/TileTooltip';
import { getTileMeta } from '@/components/sidebar/tileMeta';
import SidebarTileSkeleton from '@/components/sidebar/SidebarTileSkeleton';
import { useTileDensity } from '@/hooks/useTileDensity';
import { mobileTileDensityClasses } from '@/components/sidebar/tileDensityClasses';

// Modern infographic tints — vibrant gradient fill + matching solid + glow color
const tileTints: Record<string, { grad: string; solid: string; glow: string; ring: string }> = {
  dashboard:          { grad: 'from-sky-400 via-blue-500 to-indigo-600',        solid: 'text-sky-300',       glow: 'shadow-sky-500/40',       ring: 'ring-sky-400/30' },
  onboarding:         { grad: 'from-amber-300 via-orange-400 to-rose-500',      solid: 'text-amber-200',     glow: 'shadow-amber-500/40',     ring: 'ring-amber-400/30' },
  cases:              { grad: 'from-rose-400 via-pink-500 to-fuchsia-600',      solid: 'text-rose-200',      glow: 'shadow-rose-500/40',      ring: 'ring-rose-400/30' },
  requests:           { grad: 'from-violet-400 via-purple-500 to-indigo-600',   solid: 'text-violet-200',    glow: 'shadow-violet-500/40',    ring: 'ring-violet-400/30' },
  proposals:          { grad: 'from-cyan-300 via-teal-400 to-emerald-500',      solid: 'text-cyan-200',      glow: 'shadow-cyan-500/40',      ring: 'ring-cyan-400/30' },
  open_tickets:       { grad: 'from-orange-300 via-amber-500 to-red-500',       solid: 'text-orange-200',    glow: 'shadow-orange-500/40',    ring: 'ring-orange-400/30' },
  work_diary:         { grad: 'from-indigo-400 via-blue-500 to-cyan-500',       solid: 'text-indigo-200',    glow: 'shadow-indigo-500/40',    ring: 'ring-indigo-400/30' },
  calendar:           { grad: 'from-pink-400 via-rose-500 to-red-500',          solid: 'text-pink-200',      glow: 'shadow-pink-500/40',      ring: 'ring-pink-400/30' },
  earnings:           { grad: 'from-emerald-300 via-green-500 to-teal-600',     solid: 'text-emerald-200',   glow: 'shadow-emerald-500/40',   ring: 'ring-emerald-400/30' },
  chat:               { grad: 'from-sky-300 via-cyan-500 to-blue-600',          solid: 'text-sky-200',       glow: 'shadow-sky-500/40',       ring: 'ring-sky-400/30' },
  reviews:            { grad: 'from-yellow-300 via-amber-500 to-orange-500',    solid: 'text-yellow-200',    glow: 'shadow-yellow-500/40',    ring: 'ring-yellow-400/30' },
  profile:            { grad: 'from-purple-400 via-fuchsia-500 to-pink-500',    solid: 'text-purple-200',    glow: 'shadow-purple-500/40',    ring: 'ring-purple-400/30' },
  interviews:         { grad: 'from-fuchsia-400 via-purple-500 to-violet-600',  solid: 'text-fuchsia-200',   glow: 'shadow-fuchsia-500/40',   ring: 'ring-fuchsia-400/30' },
  verification:       { grad: 'from-emerald-300 via-teal-500 to-cyan-600',      solid: 'text-emerald-200',   glow: 'shadow-emerald-500/40',   ring: 'ring-emerald-400/30' },
  remote_access:      { grad: 'from-blue-400 via-indigo-500 to-violet-600',     solid: 'text-blue-200',      glow: 'shadow-blue-500/40',      ring: 'ring-blue-400/30' },
  knowledge:          { grad: 'from-amber-300 via-orange-500 to-pink-500',      solid: 'text-amber-200',     glow: 'shadow-amber-500/40',     ring: 'ring-amber-400/30' },
  business_processes: { grad: 'from-teal-300 via-emerald-500 to-green-600',     solid: 'text-teal-200',      glow: 'shadow-teal-500/40',      ring: 'ring-teal-400/30' },
  satisfaction:       { grad: 'from-yellow-300 via-lime-400 to-green-500',      solid: 'text-yellow-200',    glow: 'shadow-lime-500/40',      ring: 'ring-lime-400/30' },
  reports:            { grad: 'from-indigo-300 via-violet-500 to-purple-600',   solid: 'text-indigo-200',    glow: 'shadow-indigo-500/40',    ring: 'ring-indigo-400/30' },
  referrals:          { grad: 'from-pink-300 via-rose-500 to-fuchsia-600',      solid: 'text-pink-200',      glow: 'shadow-pink-500/40',      ring: 'ring-pink-400/30' },
  notifications:      { grad: 'from-amber-300 via-yellow-500 to-orange-500',    solid: 'text-amber-200',     glow: 'shadow-amber-500/40',     ring: 'ring-amber-400/30' },
  settings:           { grad: 'from-slate-300 via-gray-400 to-zinc-500',        solid: 'text-slate-200',     glow: 'shadow-slate-500/30',     ring: 'ring-slate-400/30' },
};

const defaultTint = { grad: 'from-primary via-primary/80 to-primary/60', solid: 'text-primary', glow: 'shadow-primary/30', ring: 'ring-primary/30' };

const titleize = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const menuItems = [
  { key: 'dashboard', icon: Gauge, path: '/consultant', required: true },
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

const allScreens = menuItems.map(item => ({
  key: item.key,
  label: item.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  icon: item.icon,
  group: 'Navigation',
  required: (item as any).required || false,
}));

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

  useEffect(() => {
    if (isGuest) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      supabase.from('profiles').select('onboarding_completed').eq('user_id', session.user.id).maybeSingle()
        .then(({ data }) => { if (data?.onboarding_completed) setOnboardingDone(true); });
    });
  }, [isGuest]);

  const visibleItems = menuItems.filter(item => isVisible(item.key));
  const { density } = useTileDensity();
  const dens = mobileTileDensityClasses[density];

  // Best longest-prefix match so deep sub-routes keep the parent tile active.
  const bestMatchPath = (() => {
    const path = location.pathname;
    let best = '';
    for (const item of visibleItems) {
      const p = item.path;
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
          {!collapsed && (
            <SidebarGroupLabel className="px-4 text-[10px] uppercase tracking-wider font-semibold text-sidebar-foreground/40 mb-1.5">
              {String(t('sidebar.navigation', { defaultValue: 'Navigation' }))}
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            {prefsLoading ? (
              <SidebarTileSkeleton count={12} collapsed={collapsed} />
            ) : collapsed ? (
              <SidebarMenu className="space-y-1 px-2">
                {visibleItems.map((item) => {
                  const isActive = item.path === bestMatchPath;
                  const label = String(t(`sidebar.${item.key}`, { defaultValue: titleize(item.key) }));
                  const tint = tileTints[item.key] || 'from-primary/20 to-primary/5 text-primary';
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild>
                        <TileTooltip scope="consultant" itemKey={item.key} label={label} isActive={isActive} side="right">
                          <NavLink
                            to={item.path}
                            end={item.path === '/consultant'}
                            aria-label={`${label}. ${getTileMeta('consultant', item.key, label).description}`}
                            aria-current={isActive ? 'page' : undefined}
                            className={`flex items-center justify-center rounded-xl h-10 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
                              isActive
                                ? `bg-gradient-to-br ${tint} shadow-lg`
                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                            }`}
                            activeClassName=""
                          >
                            {item.key === 'onboarding' && onboardingDone ? (
                              <CheckCircle2 aria-hidden="true" focusable="false" className="w-4 h-4 text-green-400" />
                            ) : (
                              <item.icon aria-hidden="true" focusable="false" className="w-4 h-4" />
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
                            <CheckCircle2 aria-hidden="true" focusable="false" className="w-5 h-5 text-green-500" strokeWidth={2.2} />
                          ) : (
                            <item.icon aria-hidden="true" focusable="false" className={`w-5 h-5 ${isActive ? 'text-primary-foreground drop-shadow' : ''}`} strokeWidth={2.2} />
                          )}
                        </div>
                        <span className={`flex-1 sm:flex-none ${dens.label} sm:text-[11px] font-semibold leading-tight whitespace-normal break-words sm:line-clamp-2 ${isActive ? 'text-primary-foreground' : 'text-sidebar-foreground/85 group-hover/tile:text-sidebar-foreground'}`}>
                          {label}
                        </span>
                        {isOnboardingDone && (
                          <span aria-hidden="true" className="absolute top-1 end-1 text-[8px] font-bold bg-green-500 text-white px-1 py-0.5 rounded-full">✓</span>
                        )}
                      </NavLink>
                    </TileTooltip>
                  );
                })}
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mt-auto p-3 border-t border-sidebar-border/30 space-y-2">
          <SidebarUserCard collapsed={collapsed} onClick={() => setProfileOpen(true)} />
          {!collapsed && (
            <div className="space-y-1 px-1">
              <ScreenPersonalizationDialog
                screens={allScreens}
                hiddenScreens={hiddenScreens}
                onToggle={toggleScreen}
                onResetAll={resetAll}
                collapsed={collapsed}
              />
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
