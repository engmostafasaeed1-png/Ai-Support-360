import { useState } from 'react';
import { Shield, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import AdminConsoleSidebar from '@/components/admin/console/AdminConsoleSidebar';
import OverviewSection from '@/components/admin/console/sections/OverviewSection';
import UserManagementSection from '@/components/admin/console/sections/UserManagementSection';
import RolesPermissionsSection from '@/components/admin/console/sections/RolesPermissionsSection';
import SubscriptionsSection from '@/components/admin/console/sections/SubscriptionsSection';
import { SecuritySettingsSection, AuthenticationSection, DataAccessSection, AuditLogSection } from '@/components/admin/console/sections/SecuritySections';
import { TicketManagementSection, ConsultantApprovalsSection, NDAManagementSection, MatchRequestsSection, ProjectsMilestonesSection } from '@/components/admin/console/sections/OperationsSections';
import { NotificationsSection, LocalizationSection, AppearanceSection, StorageSection, EmailSection, IntegrationsSection, EnvironmentsSection, LandingEditorSection, PlatformSettingsSection, MaintenanceSection } from '@/components/admin/console/sections/SystemSections';

export default function AdminConsolePage() {
  const isMobile = useIsMobile();
  const [activeSection, setActiveSection] = useState('overview');
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSectionSelect = (id: string) => {
    setActiveSection(id);
    setMobileOpen(false);
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'overview': return <OverviewSection />;
      case 'users': return <UserManagementSection />;
      case 'roles': return <RolesPermissionsSection />;
      case 'subscriptions': return <SubscriptionsSection />;
      case 'tickets': return <TicketManagementSection />;
      case 'approvals': return <ConsultantApprovalsSection />;
      case 'nda': return <NDAManagementSection />;
      case 'match-requests': return <MatchRequestsSection />;
      case 'projects': return <ProjectsMilestonesSection />;
      case 'security': return <SecuritySettingsSection />;
      case 'auth': return <AuthenticationSection />;
      case 'rls': return <DataAccessSection />;
      case 'audit': return <AuditLogSection />;
      case 'notifications': return <NotificationsSection />;
      case 'localization': return <LocalizationSection />;
      case 'appearance': return <AppearanceSection />;
      case 'storage': return <StorageSection />;
      case 'email': return <EmailSection />;
      case 'integrations': return <IntegrationsSection />;
      case 'environments': return <EnvironmentsSection />;
      case 'landing': return <LandingEditorSection />;
      case 'settings': return <PlatformSettingsSection />;
      case 'maintenance': return <MaintenanceSection />;
      default: return <div className="text-muted-foreground">Select a section from the sidebar.</div>;
    }
  };

  return (
    <div className="min-h-[calc(100vh-8rem)]">
      {isMobile && (
        <div className="sticky top-0 z-30 border-b border-border bg-background/85 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75 flex items-center gap-3 mb-4">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0">
                <Menu className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-4" aria-describedby={undefined}>
              <SheetTitle className="mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                <span className="font-bold text-foreground">Admin Console</span>
              </SheetTitle>
              <AdminConsoleSidebar activeSection={activeSection} onSelect={handleSectionSelect} />
            </SheetContent>
          </Sheet>
          <h1 className="font-bold text-foreground text-sm truncate">Admin Console</h1>
        </div>
      )}

      <div className="flex gap-6">
        {!isMobile && (
          <aside className="w-64 shrink-0 border-r border-border/50 pr-4">
            <div className="mb-4 flex items-center gap-2 px-3">
              <Shield className="w-5 h-5 text-primary" />
              <span className="font-bold text-foreground">Admin Console</span>
            </div>
            <AdminConsoleSidebar activeSection={activeSection} onSelect={handleSectionSelect} />
          </aside>
        )}
        <main className="flex-1 min-w-0">{renderContent()}</main>
      </div>
    </div>
  );
}
