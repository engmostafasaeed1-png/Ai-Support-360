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
  Gauge, Zap, Headset, Search, CalendarClock, VideoIcon,
  Wallet, Receipt, BookOpenCheck, BellRing, SlidersHorizontal, Globe, MessagesSquare, LogOut,
  Blocks, MonitorSmartphone, Building, PartyPopper, Flag, Wand2, Crown, ChevronRight, Plus,
  Radio, ShieldCheck, UserCog, PieChart, ListChecks, Layers3, ScrollText, HelpCircle, Wrench,
  GitPullRequestArrow, SearchX, Store, AlertOctagon, BookMarked, Workflow, Monitor,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useLogout } from '@/hooks/useLogout';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useTenant } from '@/contexts/TenantContext';
import { useScreenPreferences } from '@/hooks/useScreenPreferences';
import ScreenPersonalizationDialog from '@/components/sidebar/ScreenPersonalizationDialog';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import logo from '@/assets/logo.png';
import sidebarBanner from '@/assets/sidebar-banner.png';
import ProfileEditDialog from '@/components/profile/ProfileEditDialog';
import TileTooltip from '@/components/sidebar/TileTooltip';
import { getTileMeta } from '@/components/sidebar/tileMeta';
import SidebarTileSkeleton from '@/components/sidebar/SidebarTileSkeleton';
import { Skeleton } from '@/components/ui/skeleton';
import { useTileDensity } from '@/hooks/useTileDensity';
import { mobileTileDensityClasses } from '@/components/sidebar/tileDensityClasses';

// Per-tile color tints for visual variety (uses semantic HSL tokens via tailwind utilities)
const tileTints: Record<string, string> = {
  dashboard: 'from-blue-500/25 to-blue-500/5 text-blue-500',
  new_request: 'from-amber-500/25 to-amber-500/5 text-amber-500',
  tickets: 'from-rose-500/25 to-rose-500/5 text-rose-500',
  consultants: 'from-violet-500/25 to-violet-500/5 text-violet-500',
  sessions: 'from-cyan-500/25 to-cyan-500/5 text-cyan-500',
  video_sessions: 'from-pink-500/25 to-pink-500/5 text-pink-500',
  projects: 'from-indigo-500/25 to-indigo-500/5 text-indigo-500',
  milestones: 'from-orange-500/25 to-orange-500/5 text-orange-500',
  tasks: 'from-emerald-500/25 to-emerald-500/5 text-emerald-500',
  contracts: 'from-slate-500/25 to-slate-500/5 text-slate-500',
  business_processes: 'from-teal-500/25 to-teal-500/5 text-teal-500',
  chat: 'from-sky-500/25 to-sky-500/5 text-sky-500',
  change_management: 'from-purple-500/25 to-purple-500/5 text-purple-500',
  major_incidents: 'from-red-500/25 to-red-500/5 text-red-500',
  playbooks: 'from-yellow-500/25 to-yellow-500/5 text-yellow-600',
  payments: 'from-green-500/25 to-green-500/5 text-green-500',
  invoices: 'from-lime-500/25 to-lime-500/5 text-lime-600',
  integrations: 'from-fuchsia-500/25 to-fuchsia-500/5 text-fuchsia-500',
  remote_access: 'from-blue-500/25 to-blue-500/5 text-blue-500',
  vmware_settings: 'from-zinc-500/25 to-zinc-500/5 text-zinc-500',
  vmware_pricing: 'from-emerald-500/25 to-emerald-500/5 text-emerald-500',
  vmware_console: 'from-indigo-500/25 to-indigo-500/5 text-indigo-500',
  knowledge: 'from-amber-500/25 to-amber-500/5 text-amber-500',
  pm_tickets: 'from-rose-500/25 to-rose-500/5 text-rose-500',
  solution_architecture: 'from-violet-500/25 to-violet-500/5 text-violet-500',
  satisfaction: 'from-yellow-500/25 to-yellow-500/5 text-yellow-500',
  referrals: 'from-pink-500/25 to-pink-500/5 text-pink-500',
  team_members: 'from-cyan-500/25 to-cyan-500/5 text-cyan-500',
  reports: 'from-indigo-500/25 to-indigo-500/5 text-indigo-500',
  sla: 'from-emerald-500/25 to-emerald-500/5 text-emerald-500',
  activity_log: 'from-orange-500/25 to-orange-500/5 text-orange-500',
  company_profile: 'from-blue-500/25 to-blue-500/5 text-blue-500',
  notifications: 'from-amber-500/25 to-amber-500/5 text-amber-500',
  settings: 'from-slate-500/25 to-slate-500/5 text-slate-500',
  support: 'from-teal-500/25 to-teal-500/5 text-teal-500',
};

const titleize = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const navGroups = [
  {
    labelKey: 'sidebar.overview',
    fallback: 'Overview',
    items: [
      { key: 'dashboard', icon: Gauge, path: '/client', required: true },
      { key: 'new_request', icon: Zap, path: '/client/new-request', accent: true },
    ],
  },
  {
    labelKey: 'sidebar.work',
    fallback: 'Work',
    items: [
      { key: 'tickets', icon: Headset, path: '/client/tickets' },
      { key: 'consultants', icon: Search, path: '/client/consultants' },
      { key: 'sessions', icon: CalendarClock, path: '/client/sessions' },
      { key: 'video_sessions', icon: VideoIcon, path: '/client/video-sessions' },
      { key: 'projects', icon: Layers3, path: '/client/projects' },
      { key: 'milestones', icon: Flag, path: '/client/milestones' },
      { key: 'tasks', icon: ListChecks, path: '/client/tasks' },
      { key: 'contracts', icon: ScrollText, path: '/client/contracts', label: 'NDA Agreements' },
      { key: 'business_processes', icon: Workflow, path: '/client/business-processes' },
      { key: 'chat', icon: MessagesSquare, path: '/client/chat' },
    ],
  },
  {
    labelKey: 'sidebar.servicenow',
    fallback: 'Service Management',
    items: [
      { key: 'change_management', icon: GitPullRequestArrow, path: '/client/changes' },
      { key: 'major_incidents', icon: AlertOctagon, path: '/client/major-incidents' },
      { key: 'playbooks', icon: BookMarked, path: '/client/playbooks' },
    ],
  },
  {
    labelKey: 'sidebar.finance',
    fallback: 'Finance',
    items: [
      { key: 'payments', icon: Wallet, path: '/client/payments' },
      { key: 'invoices', icon: Receipt, path: '/client/invoices' },
    ],
  },
  {
    labelKey: 'sidebar.tools',
    fallback: 'Tools',
    items: [
      { key: 'integrations', icon: Blocks, path: '/client/integrations' },
      { key: 'remote_access', icon: MonitorSmartphone, path: '/client/remote-access' },
      { key: 'vmware_settings', icon: Wrench, path: '/client/vmware-settings' },
      { key: 'vmware_pricing', icon: Wallet, path: '/client/vmware-pricing' },
      { key: 'vmware_console', icon: Monitor, path: '/client/vmware-console' },
      { key: 'knowledge', icon: BookOpenCheck, path: '/client/knowledge' },
      { key: 'pm_tickets', icon: ListChecks, path: '/client/pm-tickets' },
      { key: 'solution_architecture', icon: Wand2, path: '/client/solution-architecture' },
      { key: 'satisfaction', icon: Crown, path: '/client/satisfaction' },
      { key: 'referrals', icon: PartyPopper, path: '/client/referrals' },
    ],
  },
  {
    labelKey: 'sidebar.management',
    fallback: 'Management',
    items: [
      { key: 'team_members', icon: UserCog, path: '/client/team' },
      { key: 'reports', icon: PieChart, path: '/client/reports' },
      { key: 'sla', icon: ShieldCheck, path: '/client/sla' },
      { key: 'activity_log', icon: Radio, path: '/client/activity-log' },
    ],
  },
  {
    labelKey: 'sidebar.account',
    fallback: 'Account',
    items: [
      { key: 'company_profile', icon: Building, path: '/client/company' },
      { key: 'notifications', icon: BellRing, path: '/client/notifications' },
      { key: 'settings', icon: SlidersHorizontal, path: '/client/settings' },
      { key: 'support', icon: HelpCircle, path: '/client/support' },
    ],
  },
];

const allScreens = navGroups.flatMap(g =>
  g.items.map(item => ({
    key: item.key,
    label: item.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: item.icon,
    group: g.labelKey.split('.')[1]?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'General',
    required: (item as any).required || false,
  }))
);

const tierColors: Record<string, string> = {
  basic: 'bg-muted text-muted-foreground',
  professional: 'bg-blue-500/10 text-blue-600',
  enterprise: 'bg-amber-500/10 text-amber-600',
};

const tierIcons: Record<string, typeof Wand2> = {
  basic: Wand2,
  professional: Wand2,
  enterprise: Crown,
};

export default function ClientSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { toggleLanguage, currentLang } = useLanguage();
  const { t } = useTranslation();
  const logout = useLogout();
  const { isGuest } = useGuestMode();
  const { tenant } = useTenant();
  const { hiddenScreens, toggleScreen, resetAll, isVisible, loading: prefsLoading } = useScreenPreferences(allScreens);

  const tier = tenant?.subscription_tier || 'basic';
  const TierIcon = tierIcons[tier] || Wand2;
  const [profileOpen, setProfileOpen] = useState(false);
  const { density } = useTileDensity();
  const dens = mobileTileDensityClasses[density];

  // Determine the best-matching nav item for the current URL so that
  // deep sub-routes (e.g. /client/tickets/123) keep the parent tile active.
  const allNavPaths = navGroups.flatMap(g => g.items.map(i => i.path));
  const bestMatchPath = (() => {
    const path = location.pathname;
    let best = '';
    for (const p of allNavPaths) {
      if (p === '/client') {
        if (path === '/client' && best === '') best = p;
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
        {/* Logo */}
        <div className="p-3 flex items-center justify-center border-b border-sidebar-border/30">
          <Link to="/" className="group">
            <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-sm group-hover:shadow-md transition-shadow">
              <img src={logo} alt="Logo" width={40} height={40} className="w-full h-full object-contain" />
            </div>
          </Link>
        </div>

        {/* Company Switcher */}
        {!collapsed && tenant && (
          <div className="mx-3 mt-2">
            <Link to="/client/companies" className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-sidebar-accent/30 hover:bg-sidebar-accent/50 transition-colors group border border-sidebar-border/20">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Building className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-sidebar-foreground block truncate">{tenant.name}</span>
                <span className="text-[10px] text-sidebar-foreground/40 capitalize">{tier} {t('sidebar.plan')}</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-sidebar-foreground/30 group-hover:text-sidebar-foreground/60 transition-colors" />
            </Link>
          </div>
        )}

        {/* Navigation Groups - Modern Tile Grid */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4">
          {prefsLoading ? (
            <div className="space-y-4">
              {[10, 6].map((tilesInGroup, gi) => (
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
                        const label = String(t(`sidebar.${item.key}`, { defaultValue: (item as any).label || titleize(item.key) }));
                        const tint = tileTints[item.key] || 'from-primary/20 to-primary/5 text-primary';
                        return (
                          <SidebarMenuItem key={item.key}>
                            <SidebarMenuButton asChild>
                              <TileTooltip scope="client" itemKey={item.key} label={label} isActive={isActive} side="right">
                                <NavLink
                                  to={item.path}
                                  end
                                  aria-label={`${label}. ${getTileMeta('client', item.key, label).description}`}
                                  aria-current={isActive ? 'page' : undefined}
                                  className={`group/item relative flex items-center justify-center rounded-xl mx-1.5 my-0.5 h-10 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
                                    isActive
                                      ? `bg-gradient-to-br ${tint} shadow-lg`
                                      : 'hover:bg-sidebar-accent/60 text-sidebar-foreground/70 hover:text-sidebar-foreground'
                                  }`}
                                  activeClassName=""
                                >
                                  <item.icon aria-hidden="true" focusable="false" className={`w-4 h-4 shrink-0 ${isActive ? '' : ''}`} />
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
                        const isAccent = (item as any).accent;
                        const label = String(t(`sidebar.${item.key}`, { defaultValue: (item as any).label || titleize(item.key) }));
                        const tint = tileTints[item.key] || 'from-primary/20 to-primary/5 text-primary';
                        return (
                          <TileTooltip key={item.key} scope="client" itemKey={item.key} label={label} isActive={isActive} side="right">
                            <NavLink
                              to={item.path}
                              end
                              aria-label={`${label}. ${getTileMeta('client', item.key, label).description}`}
                              aria-current={isActive ? 'page' : undefined}
                              className={`group/tile relative flex flex-row sm:flex-col items-center sm:items-center justify-start sm:justify-center ${dens.row} sm:gap-2 rounded-2xl sm:px-2 sm:py-3.5 sm:min-h-0 text-start sm:text-center transition-all duration-200 overflow-hidden border outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
                                isActive
                                  ? 'bg-gradient-to-br from-primary via-primary/85 to-primary/60 text-primary-foreground border-primary/50 shadow-xl shadow-primary/40 sm:scale-[1.03]'
                                  : isAccent
                                  ? 'bg-gradient-to-br from-primary/20 to-primary/5 text-primary border-primary/40 hover:from-primary/30 hover:to-primary/10 hover:shadow-lg hover:-translate-y-0.5'
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
                              <div aria-hidden="true" className={`flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-2xl shrink-0 transition-all ${
                                isActive
                                  ? 'bg-white/25 backdrop-blur-sm shadow-inner'
                                  : `bg-gradient-to-br ${tint} group-hover/tile:scale-110 shadow-sm`
                              }`}>
                                <item.icon aria-hidden="true" focusable="false" className={`w-5 h-5 ${isActive ? 'text-primary-foreground drop-shadow' : ''}`} strokeWidth={2.2} />
                              </div>
                              <span className={`flex-1 sm:flex-none text-[13px] sm:text-[11px] font-semibold leading-tight whitespace-normal break-words sm:line-clamp-2 ${isActive ? 'text-primary-foreground' : 'text-sidebar-foreground/85 group-hover/tile:text-sidebar-foreground'}`}>
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
                  <p className="text-[11px] font-bold text-primary-foreground leading-tight">SAP AI Assistant</p>
                  <p className="text-[9px] text-primary-foreground/70 mt-0.5">Get instant help with AI</p>
                </div>
                <Link to="/client/chat" className="ms-auto bg-white/20 hover:bg-white/30 text-primary-foreground text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-colors backdrop-blur-sm">
                  Try Now
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
    <ProfileEditDialog open={profileOpen} onOpenChange={setProfileOpen} role="client" />
    </>
  );
}
