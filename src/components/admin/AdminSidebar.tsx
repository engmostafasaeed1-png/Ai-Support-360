import { useTranslation } from 'react-i18next';
import { NavLink } from '@/components/NavLink';
import SidebarUserCard from '@/components/sidebar/SidebarUserCard';
import { useLocation, Link } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard, Users, Kanban, UserCheck, BarChart3,
  Settings, Shield, Globe, LogOut, Plug, Server, ClipboardList, FileSignature, PanelTop, Brain, Settings2,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useLogout } from '@/hooks/useLogout';
import { useScreenPreferences } from '@/hooks/useScreenPreferences';
import ScreenPersonalizationDialog from '@/components/sidebar/ScreenPersonalizationDialog';
import logo from '@/assets/logo.png';

const menuItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/admin', required: true },
  { key: 'console', icon: Shield, path: '/admin/console' },
  { key: 'users', icon: Users, path: '/admin/users' },
  { key: 'ticket_board', icon: Kanban, path: '/admin/tickets' },
  { key: 'approvals', icon: UserCheck, path: '/admin/approvals' },
  { key: 'analytics', icon: BarChart3, path: '/admin/analytics' },
  { key: 'integrations', icon: Plug, path: '/admin/integrations' },
  { key: 'environments', icon: Server, path: '/admin/environments' },
  { key: 'environment_logs', icon: ClipboardList, path: '/admin/environment-logs' },
  { key: 'vmware_settings', icon: Settings2, path: '/admin/vmware-settings' },
  { key: 'nda_management', icon: FileSignature, path: '/admin/nda-management' },
  { key: 'landing_editor', icon: PanelTop, path: '/admin/landing-editor' },
  { key: 'interview_training', icon: Brain, path: '/admin/interview-training' },
  { key: 'settings', icon: Settings, path: '/admin/settings' },
  { key: 'super_admin', icon: Shield, path: '/super-admin' },
];

const allScreens = menuItems.map(item => ({
  key: item.key,
  label: item.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  icon: item.icon,
  group: 'Admin',
  required: (item as any).required || false,
}));

export default function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { toggleLanguage, currentLang } = useLanguage();
  const { t } = useTranslation();
  const logout = useLogout();
  const { hiddenScreens, toggleScreen, resetAll, isVisible } = useScreenPreferences(allScreens);

  const visibleItems = menuItems.filter(item => isVisible(item.key));

  return (
    <Sidebar collapsible="icon" className="border-e border-border/50">
      <SidebarContent className="bg-sidebar text-sidebar-foreground">
        <div className={`bg-white border-b border-slate-200 shadow-sm ${collapsed ? 'p-3' : 'px-4 py-3'} flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
          <Link to="/" className="group flex items-center gap-3 min-w-0">
            <div className={`${collapsed ? 'w-10 h-10' : 'w-12 h-12'} rounded-xl overflow-hidden shrink-0 bg-white ring-1 ring-slate-200 shadow-sm group-hover:shadow-md transition-shadow flex items-center justify-center`}>
              <img src={logo} alt="AI SAP Support Now" width={collapsed ? 40 : 48} height={collapsed ? 40 : 48} className="w-full h-full object-contain p-0.5" />
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-[13px] font-bold text-slate-900 leading-tight truncate">AI SAP Support Now</span>
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Admin Console</span>
              </div>
            )}
          </Link>
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.path}
                        end
                        className={`hover:bg-sidebar-accent/50 ${isActive ? 'bg-sidebar-accent text-sidebar-primary font-medium' : ''}`}
                        activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                      >
                        <item.icon className="w-4 h-4 me-2 shrink-0" />
                        {!collapsed && <span>{t(`sidebar.${item.key}`)}</span>}
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
              <ScreenPersonalizationDialog
                screens={allScreens}
                hiddenScreens={hiddenScreens}
                onToggle={toggleScreen}
                onResetAll={resetAll}
                collapsed={collapsed}
              />
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
