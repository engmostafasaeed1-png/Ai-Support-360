import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import logo from '@/assets/brand/mark.png.asset.json';

interface SidebarBrandProps {
  to: string;
  subtitle: string;
  collapsed: boolean;
}

export default function SidebarBrand({ to, subtitle, collapsed }: SidebarBrandProps) {
  return (
    <Link
      to={to}
      aria-label={`AI Support 360, ${subtitle}`}
      className="flex items-center gap-3 rounded-lg p-0.5 outline-none transition-colors hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-black/5',
          collapsed ? 'h-8 w-8' : 'h-9 w-9',
        )}
      >
        <img src={logo.url} alt="" width={36} height={36} className="h-full w-full object-contain p-1" />
      </span>
      {!collapsed && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold text-sidebar-foreground">AI Support 360</span>
          <span className="block truncate text-[11px] text-sidebar-foreground/60">{subtitle}</span>
        </span>
      )}
    </Link>
  );
}
