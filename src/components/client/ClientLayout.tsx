import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import ClientSidebar from '@/components/client/ClientSidebar';
import PageTransition from '@/components/PageTransition';
import { FixedHeader, FixedSubHeader } from '@/components/layout/FixedHeader';
import { Outlet, useNavigate } from 'react-router-dom';
import { usePortalMargin } from '@/hooks/usePortalMargin';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { useIsConsultant } from '@/hooks/useIsConsultant';
import SecurityAlert from '@/components/SecurityAlert';
import { AlertTriangle, Briefcase, Building2 } from 'lucide-react';
import NotificationBell from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import HeaderSearchButton from '@/components/layout/HeaderSearchButton';
import LanguageSwitchButton from '@/components/layout/LanguageSwitchButton';
import { Link } from 'react-router-dom';
import HeaderNav from '@/components/HeaderNav';
import { useUserProfile } from '@/hooks/useUserProfile';
import ClientApprovalBanner from '@/components/client/ClientApprovalBanner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import logo from '@/assets/brand/mark.png.asset.json';
import Footer from '@/components/landing/Footer';

export default function ClientLayout() {
  const portalMargin = usePortalMargin();
  const navigate = useNavigate();
  const isConsultant = useIsConsultant();
  const { profile } = useUserProfile();
  useSessionTimeout();
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-canvas relative">

        <ClientSidebar />
        <div className="flex-1 flex flex-col min-w-0 relative z-[1]">
          <FixedHeader>
            <div className="flex items-center gap-3">
              <SidebarTrigger className="text-muted-foreground" />
              <Link to="/" className="flex items-center gap-2 md:hidden">
                <img src={logo.url} alt="AI Support 360" className="w-8 h-8 rounded-lg object-contain" />
                <span className="hidden font-bold text-sm text-foreground sm:inline">AI Support 360</span>
              </Link>
              <HeaderSearchButton placeholder="Search pages, features..." />
            </div>
            <div className="flex items-center gap-3">
              <Badge className="hidden xl:inline-flex bg-accent/10 text-accent border border-accent/30 px-3 py-1 text-xs font-semibold gap-1.5">
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
                      <span className="hidden xl:inline">Switch to Consultant</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p className="text-xs">Switch to Consultant view</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Link to="/client/new-request">
                <Button size="sm" variant="outline" aria-label="Emergency" title="Emergency" className="text-xs gap-1.5 border-destructive/30 bg-destructive/10 text-destructive shadow-none hover:bg-destructive hover:text-destructive-foreground">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline">Emergency</span>
                </Button>
              </Link>
              <LanguageSwitchButton />
              <NotificationBell basePath="/client" />
              <Link to="/client/settings" className="group flex items-center gap-2" aria-label="Account settings">
                <Avatar className="h-8 w-8 ring-2 ring-border transition-all group-hover:ring-accent/50">
                  {profile?.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.displayName} />}
                  <AvatarFallback className="bg-gradient-to-br from-accent to-primary text-xs font-bold text-primary-foreground">
                    {profile?.initials || 'U'}
                  </AvatarFallback>
                </Avatar>
              </Link>
            </div>
          </FixedHeader>
          <FixedSubHeader>
            <HeaderNav role="client" />
          </FixedSubHeader>
          <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto pb-6 mt-14 md:mt-24 protected-content" style={{ marginLeft: `${portalMargin}%`, marginRight: `${portalMargin}%` }}>
            <SecurityAlert />
            <ClientApprovalBanner />
            <PageTransition>
              <Outlet />
            </PageTransition>
          </main>
          <Footer compact />
        </div>
      </div>
    </SidebarProvider>
  );
}
