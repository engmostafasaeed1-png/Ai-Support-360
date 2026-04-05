import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, Link } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { MoreHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  key: string;
  icon: LucideIcon;
  path: string;
  labelKey: string;
}

interface MobileBottomNavProps {
  items: NavItem[];
  moreItems?: NavItem[];
}

export default function MobileBottomNav({ items, moreItems = [] }: MobileBottomNavProps) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (!isMobile) return null;

  const isMoreActive = moreItems.some((item) => location.pathname === item.path);

  return (
    <>
      <nav className="fixed bottom-0 inset-x-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border/50 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-center justify-around h-14">
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.key}
                to={item.path}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-0 transition-colors ${
                  isActive ? 'text-accent' : 'text-muted-foreground'
                }`}
              >
                <item.icon className="w-5 h-5 shrink-0" />
                <span className="text-[10px] font-medium truncate max-w-[56px]">
                  {t(item.labelKey)}
                </span>
              </Link>
            );
          })}
          {moreItems.length > 0 && (
            <button
              onClick={() => setOpen(true)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-0 transition-colors ${
                isMoreActive ? 'text-accent' : 'text-muted-foreground'
              }`}
            >
              <MoreHorizontal className="w-5 h-5 shrink-0" />
              <span className="text-[10px] font-medium">{t('sidebar.more', 'More')}</span>
            </button>
          )}
        </div>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base">{t('sidebar.more', 'More')}</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-4 gap-3 py-4">
            {moreItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.key}
                  to={item.path}
                  onClick={() => setOpen(false)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors ${
                    isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="text-[11px] font-medium text-center leading-tight">
                    {t(item.labelKey)}
                  </span>
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
