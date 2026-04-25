import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ClientSidebar from '@/components/client/ClientSidebar';
import PageTransition from '@/components/PageTransition';
import { FixedHeader, FixedSubHeader } from '@/components/layout/FixedHeader';
import { Outlet } from 'react-router-dom';
import { usePortalMargin } from '@/hooks/usePortalMargin';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import SecurityAlert from '@/components/SecurityAlert';
import {
  Search, AlertTriangle, LayoutDashboard, TicketPlus, Users,
  MessageSquare, Settings, Settings2, Briefcase, Calendar, CreditCard,
  FileText, BookOpen, Bell, Plug, Server, Video, FolderKanban, Milestone,
  ClipboardList, FileSignature, GitBranch, Bug, Package, Siren, BookMarked,
  DollarSign, Monitor, Sparkles, Gift, UsersRound, BarChart3, Shield,
  Activity, Building2, LifeBuoy, Brain, Network,
} from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import dashboardBgAsset from '@/assets/videos/dashboard-bg.mp4.asset.json';
import HeaderNav from '@/components/HeaderNav';
import logo from '@/assets/logo.png';

const bottomNavItems = [
  { key: 'dashboard', icon: LayoutDashboard, path: '/client', labelKey: 'sidebar.dashboard' },
  { key: 'new_request', icon: TicketPlus, path: '/client/new-request', labelKey: 'sidebar.new_request' },
  { key: 'consultants', icon: Users, path: '/client/consultants', labelKey: 'sidebar.consultants' },
  { key: 'chat', icon: MessageSquare, path: '/client/chat', labelKey: 'sidebar.chat' },
];

const moreNavItems = [
  { key: 'tickets', icon: Briefcase, path: '/client/tickets', labelKey: 'sidebar.tickets' },
  { key: 'sessions', icon: Calendar, path: '/client/sessions', labelKey: 'sidebar.sessions' },
  { key: 'video_sessions', icon: Video, path: '/client/video-sessions', labelKey: 'sidebar.video_sessions' },
  { key: 'projects', icon: FolderKanban, path: '/client/projects', labelKey: 'sidebar.projects' },
  { key: 'milestones', icon: Milestone, path: '/client/milestones', labelKey: 'sidebar.milestones' },
  { key: 'tasks', icon: ClipboardList, path: '/client/tasks', labelKey: 'sidebar.tasks' },
  { key: 'contracts', icon: FileSignature, path: '/client/contracts', labelKey: 'sidebar.contracts' },
  { key: 'business_processes', icon: Network, path: '/client/business-processes', labelKey: 'sidebar.business_processes' },
  { key: 'changes', icon: GitBranch, path: '/client/changes', labelKey: 'sidebar.change_management' },
  { key: 'changes', icon: GitBranch, path: '/client/changes', labelKey: 'sidebar.change_management' },
  { key: 'problems', icon: Bug, path: '/client/problems', labelKey: 'sidebar.problem_management' },
  { key: 'major_incidents', icon: Siren, path: '/client/major-incidents', labelKey: 'sidebar.major_incidents' },
  { key: 'playbooks', icon: BookMarked, path: '/client/playbooks', labelKey: 'sidebar.playbooks' },
  { key: 'payments', icon: CreditCard, path: '/client/payments', labelKey: 'sidebar.payments' },
  { key: 'invoices', icon: FileText, path: '/client/invoices', labelKey: 'sidebar.invoices' },
  { key: 'integrations', icon: Plug, path: '/client/integrations', labelKey: 'sidebar.integrations' },
  { key: 'remote_access', icon: Server, path: '/client/remote-access', labelKey: 'sidebar.remote_access' },
  { key: 'vmware_settings', icon: Settings2, path: '/client/vmware-settings', labelKey: 'sidebar.vmware_settings' },
  { key: 'vmware_pricing', icon: DollarSign, path: '/client/vmware-pricing', labelKey: 'sidebar.vmware_pricing' },
  { key: 'vmware_console', icon: Monitor, path: '/client/vmware-console', labelKey: 'sidebar.vmware_console' },
  { key: 'knowledge', icon: BookOpen, path: '/client/knowledge', labelKey: 'sidebar.knowledge' },
  { key: 'pm_tickets', icon: ClipboardList, path: '/client/pm-tickets', labelKey: 'sidebar.pm_tickets' },
  { key: 'solution_architecture', icon: Sparkles, path: '/client/solution-architecture', labelKey: 'sidebar.solution_architecture' },
  { key: 'referrals', icon: Gift, path: '/client/referrals', labelKey: 'sidebar.referrals' },
  { key: 'team', icon: UsersRound, path: '/client/team', labelKey: 'sidebar.team_members' },
  { key: 'reports', icon: BarChart3, path: '/client/reports', labelKey: 'sidebar.reports' },
  { key: 'sla', icon: Shield, path: '/client/sla', labelKey: 'sidebar.sla' },
  { key: 'activity_log', icon: Activity, path: '/client/activity-log', labelKey: 'sidebar.activity_log' },
  { key: 'company', icon: Building2, path: '/client/company', labelKey: 'sidebar.company_profile' },
  { key: 'notifications', icon: Bell, path: '/client/notifications', labelKey: 'sidebar.notifications' },
  { key: 'settings', icon: Settings, path: '/client/settings', labelKey: 'sidebar.settings' },
  { key: 'support', icon: LifeBuoy, path: '/client/support', labelKey: 'sidebar.support' },
];

export default function ClientLayout() {
  const portalMargin = usePortalMargin();
  useSessionTimeout();
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background relative">
        <div className="fixed inset-0 z-0 pointer-events-none">
          <video autoPlay muted loop playsInline className="w-full h-full object-cover opacity-[0.03]">
            <source src={dashboardBgAsset.url} type="video/mp4" />
          </video>
        </div>

        <ClientSidebar />
        <div className="flex-1 flex flex-col min-w-0 relative z-[1]">
          <FixedHeader>
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground" />
              <Link to="/" className="flex items-center gap-2 md:hidden">
                <img src={logo} alt="AI SAP Support Now" className="w-8 h-8 rounded-lg object-contain" />
                <span className="font-bold text-sm text-foreground">AI SAP Support Now</span>
              </Link>
              <div className="hidden md:flex items-center relative">
                <Search className="w-4 h-4 absolute start-3 text-muted-foreground" />
                <Input
                  placeholder="Search tickets, consultants..."
                  className="ps-9 h-9 w-64 rounded-xl bg-muted/40 border-border/40 focus-visible:ring-accent/50 transition-all focus:w-80"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge className="bg-accent/10 text-accent border border-accent/30 px-3 py-1 text-xs font-semibold gap-1.5">
                <Building2 className="w-3.5 h-3.5" />
                Client
              </Badge>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs gap-1.5 border-border/50 hover:bg-primary/10"
                    onClick={() => window.location.href = '/consultant'}
                  >
                    <Briefcase className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Switch to Consultant</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Switch to Consultant view</p>
                </TooltipContent>
              </Tooltip>
              <Link to="/client/new-request">
                <Button size="sm" variant="destructive" className="text-xs gap-1.5 shadow-sm hover:shadow-md transition-shadow">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Emergency</span>
                </Button>
              </Link>
              <NotificationBell basePath="/client" />
              <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-primary-foreground text-xs font-bold shadow-premium">
                KO
              </div>
            </div>
          </FixedHeader>
          <FixedSubHeader>
            <HeaderNav role="client" />
          </FixedSubHeader>
          <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto pb-6 mt-14 md:mt-24 protected-content" style={{ marginLeft: `${portalMargin}%`, marginRight: `${portalMargin}%` }}>
            <SecurityAlert />
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
