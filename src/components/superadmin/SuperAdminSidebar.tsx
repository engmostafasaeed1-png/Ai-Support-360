import { useTranslation } from 'react-i18next';
import { NavLink } from '@/components/NavLink';
import SidebarUserCard from '@/components/sidebar/SidebarUserCard';
import { useLocation, Link } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard, ShieldCheck, BarChart3, Settings2, Workflow,
  Globe, LogOut, Crown, FileText, Activity, Users, Lock, Database,
  PieChart,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useLogout } from '@/hooks/useLogout';
import { useScreenPreferences } from '@/hooks/useScreenPreferences';
import ScreenPersonalizationDialog from '@/components/sidebar/ScreenPersonalizationDialog';
import logo from '@/assets/logo.png';

const menuItems = [
  { key: 'overview', icon: LayoutDashboard, path: '/super-admin', labelKey: 'super_admin.overview', required: true },
  { key: 'executive', icon: PieChart, path: '/super-admin/executive', labelKey: 'super_admin.executive_dashboard' },
  { key: 'roles', icon: ShieldCheck, path: '/super-admin/roles', labelKey: 'super_admin.roles' },
  { key: 'users', icon: Users, path: '/super-admin/users', labelKey: 'super_admin.user_management' },
  { key: 'reports', icon: BarChart3, path: '/super-admin/reports', labelKey: 'super_admin.reports' },
  { key: 'config', icon: Settings2, path: '/super-admin/config', labelKey: 'super_admin.config' },
  { key: 'workflows', icon: Workflow, path: '/super-admin/workflows', labelKey: 'super_admin.workflows' },
  { key: 'audit', icon: FileText, path: '/super-admin/audit', labelKey: 'super_admin.audit_logs' },
  { key: 'system', icon: Activity, path: '/super-admin/system', labelKey: 'super_admin.system_health' },
];

const allScreens = menuItems.map(item => ({
  key: item.key,
  label: item.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  icon: item.icon,
  group: 'Super Admin',
  required: (item as any).required || false,
}));

export default function SuperAdminSidebar() {
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
        <div className="p-3 flex items-center gap-2.5 border-b border-sidebar-border/30">
          <Link to="/super-admin" className="flex items-center gap-2.5 group">
            <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 shadow-sm group-hover:shadow-md transition-shadow">
              <img src={logo} alt="AI SAP Support Now" width={48} height={48} className="w-full h-full object-contain" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <span className="font-bold text-sm text-sidebar-foreground block leading-tight">AI SAP Support Now</span>
                <span className="text-[10px] text-sidebar-foreground/40 leading-tight">{t('super_admin.title', 'Super Admin')}</span>
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
                        {!collapsed && <span>{t(item.labelKey, item.key)}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink to="/admin" className="hover:bg-sidebar-accent/50">
                    <Database className="w-4 h-4 me-2 shrink-0" />
                    {!collapsed && <span>{t('super_admin.standard_admin', 'Standard Admin')}</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
