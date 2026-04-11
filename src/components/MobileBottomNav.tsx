import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, Link } from 'react-router-dom';
import { useIsMobile } from '@/hooks/use-mobile';
import { MoreHorizontal, Globe } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useLanguage } from '@/hooks/useLanguage';
import { Separator } from '@/components/ui/separator';
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

function createRipple(e: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const ripple = document.createElement('span');

  let x: number, y: number;
  if ('touches' in e && e.touches.length) {
    x = e.touches[0].clientX - rect.left;
    y = e.touches[0].clientY - rect.top;
  } else if ('clientX' in e) {
    x = (e as React.MouseEvent).clientX - rect.left;
    y = (e as React.MouseEvent).clientY - rect.top;
  } else {
    x = rect.width / 2;
    y = rect.height / 2;
  }

  const size = Math.max(rect.width, rect.height) * 2;
  Object.assign(ripple.style, {
    position: 'absolute',
    borderRadius: '50%',
    width: `${size}px`,
    height: `${size}px`,
    left: `${x - size / 2}px`,
    top: `${y - size / 2}px`,
    background: 'currentColor',
    opacity: '0.15',
    transform: 'scale(0)',
    animation: 'ripple-expand 0.5s ease-out forwards',
    pointerEvents: 'none',
  });

  el.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

export default function MobileBottomNav({ items, moreItems = [] }: MobileBottomNavProps) {
  const isMobile = useIsMobile();
  const location = useLocation();
  const { t } = useTranslation();
  const { toggleLanguage, currentLang } = useLanguage();
  const [open, setOpen] = useState(false);

  if (!isMobile) return null;

  const isMoreActive = moreItems.some((item) => location.pathname === item.path);

  return (
    <>
      <nav role="navigation" aria-label="Mobile navigation" className="fixed bottom-0 inset-x-0 z-50 bg-background/95 backdrop-blur-xl border-t border-border/50 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-around h-16">
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.key}
                to={item.path}
                onTouchStart={createRipple}
                onMouseDown={createRipple}
                className={`relative overflow-hidden flex flex-col items-center gap-1 px-3 py-1.5 min-w-0 transition-all rounded-xl ${
                  isActive ? 'text-accent bg-accent/8' : 'text-muted-foreground active:scale-90'
                }`}
              >
                <item.icon className={`w-5 h-5 shrink-0 transition-all duration-200 ${isActive ? 'scale-110' : ''}`} />
                <span className={`text-[10px] font-medium truncate max-w-[56px] transition-all ${isActive ? 'font-semibold' : ''}`}>
                  {t(item.labelKey)}
                </span>
                {isActive && <span className="absolute -top-0.5 w-4 h-0.5 rounded-full bg-accent" />}
              </Link>
            );
          })}
          {moreItems.length > 0 && (
            <button
              onClick={() => setOpen(true)}
              onTouchStart={createRipple}
              onMouseDown={createRipple}
              className={`relative overflow-hidden flex flex-col items-center gap-0.5 px-2 py-1 min-w-0 transition-colors rounded-lg ${
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
                  onTouchStart={createRipple}
                  onMouseDown={createRipple}
                  className={`relative overflow-hidden flex flex-col items-center gap-1.5 p-3 rounded-xl transition-colors ${
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
          <Separator />
          <button
            onClick={() => { toggleLanguage(); setOpen(false); }}
            className="flex items-center gap-3 w-full px-3 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Globe className="w-5 h-5" />
            <span>{currentLang === 'en' ? 'العربية' : 'English'}</span>
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}
