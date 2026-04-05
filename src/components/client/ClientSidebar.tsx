import { NavLink } from '@/components/NavLink';
import { useLocation, Link } from 'react-router-dom';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from '@/components/ui/sidebar';
import {
  LayoutDashboard, TicketPlus, Briefcase, Users, Calendar,
  CreditCard, FileText, BookOpen, Bell, Settings, Globe, MessageSquare,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const menuItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/client' },
  { key: 'new_request', icon: TicketPlus, path: '/client/new-request' },
  { key: 'tickets', icon: Briefcase, path: '/client/tickets' },
  { key: 'consultants', icon: Users, path: '/client/consultants' },
  { key: 'sessions', icon: Calendar, path: '/client/sessions' },
  { key: 'payments', icon: CreditCard, path: '/client/payments' },
  { key: 'invoices', icon: FileText, path: '/client/invoices' },
  { key: 'knowledge', icon: BookOpen, path: '/client/knowledge' },
  { key: 'notifications', icon: Bell, path: '/client/notifications' },
  { key: 'settings', icon: Settings, path: '/client/settings' },
];

const labels: Record<string, string> = {
  dashboard: 'Dashboard',
  new_request: 'New Request',
  tickets: 'My Tickets',
  consultants: 'Consultants',
  sessions: 'Sessions',
  payments: 'Payments',
  invoices: 'Invoices',
  knowledge: 'Knowledge Base',
  notifications: 'Notifications',
  settings: 'Settings',
};

export default function ClientSidebar() {
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const location = useLocation();
  const { toggleLanguage, currentLang } = useLanguage();

  return (
    <Sidebar collapsible="icon" className="border-e border-border/50">
      <SidebarContent className="bg-sidebar text-sidebar-foreground">
        <div className="p-4 flex items-center gap-2">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary-foreground">Q</span>
            </div>
            {!collapsed && <span className="font-bold text-sm text-sidebar-foreground">Client Portal</span>}
          </Link>
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50">Menu</SidebarGroupLabel>
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
                        {!collapsed && <span>{labels[item.key]}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!collapsed && (
          <div className="mt-auto p-4 border-t border-sidebar-border">
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-2 text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors"
            >
              <Globe className="w-3.5 h-3.5" />
              {currentLang === 'en' ? 'العربية' : 'English'}
            </button>
          </div>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
