import { Skeleton } from '@/components/ui/skeleton';

interface SidebarTileSkeletonProps {
  /** Number of placeholder tiles to render. Defaults to 8. */
  count?: number;
  /** When true, shows the slim icon-rail variant for the collapsed sidebar. */
  collapsed?: boolean;
}

/**
 * Loading placeholder that mirrors the sidebar tile grid layout so the user
 * sees a visually-stable skeleton while navigation data (preferences, tenant,
 * onboarding) is fetched.
 *
 * Layout matches the live grid:
 *   - Mobile (<sm):   1 column, row tiles (icon + label)
 *   - Desktop (sm+):  2 columns, square-ish tiles
 *   - Collapsed:      single icon-only column
 */
export default function SidebarTileSkeleton({
  count = 8,
  collapsed = false,
}: SidebarTileSkeletonProps) {
  if (collapsed) {
    return (
      <div
        className="flex flex-col gap-1 px-2 py-1"
        role="status"
        aria-label="Loading navigation"
        aria-busy="true"
      >
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-xl bg-sidebar-accent/30" />
        ))}
        <span className="sr-only">Loading navigation</span>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-3"
      role="status"
      aria-label="Loading navigation"
      aria-busy="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-row sm:flex-col items-center sm:items-center justify-start sm:justify-center gap-3 sm:gap-2 rounded-2xl px-3 sm:px-2 py-2.5 sm:py-3.5 border border-sidebar-border/30 bg-sidebar-accent/15 min-h-[52px] sm:min-h-[78px] overflow-hidden"
        >
          <Skeleton className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl shrink-0 bg-sidebar-accent/40" />
          <div className="flex-1 sm:w-full sm:flex-none flex flex-col gap-1.5 items-start sm:items-center">
            <Skeleton className="h-2.5 w-3/4 sm:w-4/5 rounded-full bg-sidebar-accent/40" />
            <Skeleton className="h-2.5 w-1/2 sm:w-3/5 rounded-full bg-sidebar-accent/30 hidden sm:block" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading navigation</span>
    </div>
  );
}
