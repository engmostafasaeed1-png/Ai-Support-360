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
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useLogout } from '@/hooks/useLogout';

const menuItems = [
  { key: 'overview', icon: LayoutDashboard, path: '/super-admin', labelKey: 'super_admin.overview' },
  { key: 'roles', icon: ShieldCheck, path: '/super-admin/roles', labelKey: 'super_admin.roles' },
  { key: 'users', icon: Users, path: '/super-admin/users', labelKey: 'super_admin.user_management' },
  { key: 'reports', icon: BarChart3, path: '/super-admin/reports', labelKey: 'super_admin.reports' },
  { key: 'config', icon: Settings2, path: '/super-admin/config', labelKey: 'super_admin.config' },
  { key: 'workflows', icon: Workflow, path: '/super-admin/workflows', labelKey: 'super_admin.workflows' },
  { key: 'audit', icon: FileText, path: '/super-admin/audit', labelKey: 'super_admin.audit_logs' },
  { key: 'system', icon: Activity, path: '/super-admin/system', labelKey: 'super_admin.system_health' },
];

export default function SuperAdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { toggleLanguage, currentLang } = useLanguage();
  const { t } = useTranslation();
  const logout = useLogout();

  return (
    <Sidebar collapsible="icon" className="border-e border-border/50">
      <SidebarContent className="bg-sidebar text-sidebar-foreground">
        <div className="p-4 flex items-center gap-2">
          <Link to="/super-admin" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
              <Crown className="w-4 h-4 text-white" />
            </div>
            {!collapsed && <span className="font-bold text-sm text-sidebar-foreground">{t('super_admin.title', 'Super Admin')}</span>}
          </Link>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50">{t('super_admin.control_center', 'Control Center')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
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
          <SidebarGroupLabel className="text-sidebar-foreground/50">{t('super_admin.quick_links', 'Quick Links')}</SidebarGroupLabel>
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
