import { useTranslation } from 'react-i18next';
import { useLocation, Link } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  key: string;
  icon: LucideIcon;
  path: string;
  labelKey: string;
}

interface MobileBottomNavProps {
  items: NavItem[];
}

export default function MobileBottomNav({ items }: MobileBottomNavProps) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { t } = useTranslation();

  if (!isMobile) return null;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border/50 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.key}
              to={item.path}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 min-w-0 transition-colors ${
                isActive
                  ? 'text-accent'
                  : 'text-muted-foreground'
              }`}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <span className="text-[10px] font-medium truncate max-w-[56px]">
                {t(item.labelKey)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
