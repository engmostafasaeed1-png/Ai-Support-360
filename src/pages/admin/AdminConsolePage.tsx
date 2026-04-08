import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Shield, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import AdminConsoleSidebar from '@/components/admin/console/AdminConsoleSidebar';

export default function AdminConsolePage() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Extract active section from path: /admin/console/users → users
  const pathParts = location.pathname.split('/');
  const activeSection = pathParts[3] || 'overview';

  const handleSectionSelect = (id: string) => {
    navigate(id === 'overview' ? '/admin/console' : `/admin/console/${id}`);
    setMobileOpen(false);
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
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}