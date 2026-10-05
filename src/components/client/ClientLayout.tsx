import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ClientSidebar from '@/components/client/ClientSidebar';
import PageTransition from '@/components/PageTransition';
import { FixedHeader, FixedSubHeader } from '@/components/layout/FixedHeader';
import { Outlet, useNavigate } from 'react-router-dom';
import { usePortalMargin } from '@/hooks/usePortalMargin';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { useIsConsultant } from '@/hooks/useIsConsultant';
import SecurityAlert from '@/components/SecurityAlert';
import { Search, AlertTriangle, Briefcase, Building2 } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import dashboardBgAsset from '@/assets/videos/dashboard-bg.mp4.asset.json';
import HeaderNav from '@/components/HeaderNav';
import logo from '@/assets/logo.png';

export default function ClientLayout() {
  const portalMargin = usePortalMargin();
  const navigate = useNavigate();
  const isConsultant = useIsConsultant();
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
                <img src={logo} alt="AI Support Now" className="w-8 h-8 rounded-lg object-contain" />
                <span className="font-bold text-sm text-foreground">AI Support Now</span>
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
              {isConsultant && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs gap-1.5 border-border/50 hover:bg-primary/10"
                      onClick={() => navigate('/consultant')}
                    >
                      <Briefcase className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Switch to Consultant</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">Switch to Consultant view</p>
                  </TooltipContent>
                </Tooltip>
              )}
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
