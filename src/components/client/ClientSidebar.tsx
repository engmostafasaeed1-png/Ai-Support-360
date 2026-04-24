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

const navGroups = [
  {
    labelKey: 'sidebar.overview',
    items: [
      { key: 'dashboard', icon: Gauge, path: '/client', required: true },
      { key: 'new_request', icon: Zap, path: '/client/new-request', accent: true },
    ],
  },
  {
    labelKey: 'sidebar.work',
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
    items: [
      { key: 'change_management', icon: GitPullRequestArrow, path: '/client/changes' },
      { key: 'major_incidents', icon: AlertOctagon, path: '/client/major-incidents' },
      { key: 'playbooks', icon: BookMarked, path: '/client/playbooks' },
    ],
  },
  {
    labelKey: 'sidebar.finance',
    items: [
      { key: 'payments', icon: Wallet, path: '/client/payments' },
      { key: 'invoices', icon: Receipt, path: '/client/invoices' },
    ],
  },
  {
    labelKey: 'sidebar.tools',
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
    items: [
      { key: 'team_members', icon: UserCog, path: '/client/team' },
      { key: 'reports', icon: PieChart, path: '/client/reports' },
      { key: 'sla', icon: ShieldCheck, path: '/client/sla' },
      { key: 'activity_log', icon: Radio, path: '/client/activity-log' },
    ],
  },
  {
    labelKey: 'sidebar.account',
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
  const { hiddenScreens, toggleScreen, resetAll, isVisible } = useScreenPreferences(allScreens);

  const tier = tenant?.subscription_tier || 'basic';
  const TierIcon = tierIcons[tier] || Wand2;
  const [profileOpen, setProfileOpen] = useState(false);

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
          {navGroups.map((group) => {
            const visibleItems = group.items.filter(item => isVisible(item.key));
            if (visibleItems.length === 0) return null;
            return (
              <SidebarGroup key={group.labelKey}>
                {!collapsed && (
                  <SidebarGroupLabel className="px-4 text-[10px] uppercase tracking-wider font-semibold text-sidebar-foreground/40 mb-1.5">
                    {t(group.labelKey)}
                  </SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                  {collapsed ? (
                    <SidebarMenu>
                      {visibleItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        return (
                          <SidebarMenuItem key={item.key}>
                            <SidebarMenuButton asChild tooltip={t(`sidebar.${item.key}`)}>
                              <NavLink
                                to={item.path}
                                end
                                className={`group/item relative flex items-center justify-center rounded-xl mx-1.5 my-0.5 h-10 transition-all duration-200 ${
                                  isActive
                                    ? 'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/30'
                                    : 'hover:bg-sidebar-accent/60 text-sidebar-foreground/70 hover:text-sidebar-foreground'
                                }`}
                                activeClassName=""
                              >
                                <item.icon className="w-4 h-4 shrink-0" />
                              </NavLink>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 px-3">
                      {visibleItems.map((item) => {
                        const isActive = location.pathname === item.path;
                        const isAccent = (item as any).accent;
                        return (
                          <NavLink
                            key={item.key}
                            to={item.path}
                            end
                            className={`group/tile relative flex flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-center transition-all duration-200 overflow-hidden border ${
                              isActive
                                ? 'bg-gradient-to-br from-primary to-primary/60 text-primary-foreground border-primary/40 shadow-lg shadow-primary/30 scale-[1.02]'
                                : isAccent
                                ? 'bg-gradient-to-br from-primary/15 to-primary/5 text-primary border-primary/30 hover:from-primary/25 hover:to-primary/10 hover:shadow-md'
                                : 'bg-sidebar-accent/20 hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground border-sidebar-border/30 hover:border-sidebar-border/60 hover:shadow-md hover:-translate-y-0.5'
                            }`}
                            activeClassName=""
                          >
                            {isActive && (
                              <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/10 to-white/0 pointer-events-none" />
                            )}
                            <div className={`flex items-center justify-center w-8 h-8 rounded-xl shrink-0 transition-all ${
                              isActive
                                ? 'bg-white/25 backdrop-blur-sm'
                                : isAccent
                                ? 'bg-primary/20'
                                : 'bg-sidebar-background/60 group-hover/tile:bg-sidebar-background/90 shadow-sm'
                            }`}>
                              <item.icon className={`w-4 h-4 ${isActive ? 'text-primary-foreground' : isAccent ? 'text-primary' : 'text-sidebar-foreground/70 group-hover/tile:text-sidebar-foreground'}`} />
                            </div>
                            <span className="text-[10.5px] font-medium leading-tight line-clamp-2">
                              {t(`sidebar.${item.key}`)}
                            </span>
                          </NavLink>
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
