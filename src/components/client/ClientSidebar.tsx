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
  LayoutDashboard, TicketPlus, Briefcase, Users, Calendar,
  CreditCard, FileText, BookOpen, Bell, Settings, Globe, MessageSquare, LogOut,
  Plug, Server, Building2, Gift, Milestone, Sparkles, Crown, ChevronRight,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useLogout } from '@/hooks/useLogout';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useTenant } from '@/contexts/TenantContext';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import qurtubaLogo from '@/assets/qurtuba-logo.png';
import sidebarBanner from '@/assets/sidebar-banner.png';

const navGroups = [
  {
    labelKey: 'sidebar.overview',
    items: [
      { key: 'dashboard', icon: LayoutDashboard, path: '/client' },
      { key: 'new_request', icon: TicketPlus, path: '/client/new-request', accent: true },
    ],
  },
  {
    labelKey: 'sidebar.work',
    items: [
      { key: 'tickets', icon: Briefcase, path: '/client/tickets' },
      { key: 'consultants', icon: Users, path: '/client/consultants' },
      { key: 'sessions', icon: Calendar, path: '/client/sessions' },
      { key: 'milestones', icon: Milestone, path: '/client/milestones' },
      { key: 'chat', icon: MessageSquare, path: '/client/chat' },
    ],
  },
  {
    labelKey: 'sidebar.finance',
    items: [
      { key: 'payments', icon: CreditCard, path: '/client/payments' },
      { key: 'invoices', icon: FileText, path: '/client/invoices' },
    ],
  },
  {
    labelKey: 'sidebar.tools',
    items: [
      { key: 'integrations', icon: Plug, path: '/client/integrations' },
      { key: 'remote_access', icon: Server, path: '/client/remote-access' },
      { key: 'knowledge', icon: BookOpen, path: '/client/knowledge' },
      { key: 'referrals', icon: Gift, path: '/client/referrals' },
    ],
  },
  {
    labelKey: 'sidebar.account',
    items: [
      { key: 'company_profile', icon: Building2, path: '/client/company' },
      { key: 'notifications', icon: Bell, path: '/client/notifications' },
      { key: 'settings', icon: Settings, path: '/client/settings' },
    ],
  },
];

const tierColors: Record<string, string> = {
  basic: 'bg-muted text-muted-foreground',
  professional: 'bg-blue-500/10 text-blue-600',
  enterprise: 'bg-amber-500/10 text-amber-600',
};

const tierIcons: Record<string, typeof Sparkles> = {
  basic: Sparkles,
  professional: Sparkles,
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

  const tier = tenant?.subscription_tier || 'basic';
  const TierIcon = tierIcons[tier] || Sparkles;

  return (
    <Sidebar collapsible="icon" className="border-e border-border/30">
      <SidebarContent className="bg-sidebar text-sidebar-foreground flex flex-col">
        {/* Logo */}
        <div className="p-3 flex items-center gap-2.5 border-b border-sidebar-border/30">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-sm group-hover:shadow-md transition-shadow">
              <img src={qurtubaLogo} alt="Qurtuba" width={36} height={36} className="w-full h-full object-contain" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <span className="font-bold text-sm text-sidebar-foreground block leading-tight">Qurtuba</span>
                <span className="text-[10px] text-sidebar-foreground/40 leading-tight">{t('sidebar.client_portal')}</span>
              </div>
            )}
          </Link>
        </div>

        {/* Subscription Badge */}
        {!collapsed && (
          <div className="mx-3 mt-3">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${tierColors[tier]} text-xs font-medium`}>
              <TierIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="capitalize">{tier} Plan</span>
              {tier === 'basic' && (
                <Link to="/client/settings" className="ms-auto flex items-center gap-0.5 text-[10px] font-semibold text-primary hover:underline">
                  Upgrade <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Navigation Groups */}
        <div className="flex-1 overflow-y-auto py-2 space-y-1">
          {navGroups.map((group) => (
            <SidebarGroup key={group.labelKey}>
              {!collapsed && (
                <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/35 font-semibold px-3 mb-0.5">
                  {t(group.labelKey, group.labelKey.split('.')[1])}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.path;
                    const isAccent = (item as any).accent;
                    return (
                      <SidebarMenuItem key={item.key}>
                        <SidebarMenuButton asChild>
                          <NavLink
                            to={item.path}
                            end
                            className={`group/item relative rounded-lg mx-1 transition-all duration-150 ${
                              isActive
                                ? 'bg-primary/10 text-primary font-semibold shadow-sm'
                                : isAccent
                                ? 'text-primary hover:bg-primary/5'
                                : 'hover:bg-sidebar-accent/50 text-sidebar-foreground/70 hover:text-sidebar-foreground'
                            }`}
                            activeClassName="bg-primary/10 text-primary font-semibold"
                          >
                            {isActive && (
                              <div className="absolute inset-y-1 start-0 w-[3px] rounded-full bg-primary" />
                            )}
                            <item.icon className={`w-4 h-4 me-2.5 shrink-0 transition-colors ${
                              isActive ? 'text-primary' : isAccent ? 'text-primary' : 'text-sidebar-foreground/50 group-hover/item:text-sidebar-foreground/70'
                            }`} />
                            {!collapsed && (
                              <span className="text-[13px]">{t(`sidebar.${item.key}`)}</span>
                            )}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
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
          <SidebarUserCard collapsed={collapsed} />
          {!collapsed && (
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
          )}
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
