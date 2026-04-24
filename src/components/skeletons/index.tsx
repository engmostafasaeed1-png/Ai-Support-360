import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

/**
 * Reusable skeleton loaders. Use these instead of bare <Loader2 /> spinners
 * for content placeholders so users see structural hints while data loads.
 *
 * All skeletons use semantic tokens via the shadcn `<Skeleton />` primitive.
 */

export const TicketCardSkeleton = () => (
  <Card className="rounded-2xl border-border/50">
    <CardHeader className="pb-3">
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-1/3 mt-2" />
    </CardHeader>
    <CardContent className="space-y-2">
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
      <div className="flex items-center gap-2 pt-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </CardContent>
  </Card>
);

export const ConsultantCardSkeleton = () => (
  <Card className="rounded-2xl border-border/50">
    <CardContent className="p-5 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-6 w-14 rounded-full" />
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-12 rounded-full" />
      </div>
    </CardContent>
  </Card>
);

export const DashboardStatSkeleton = () => (
  <Card className="rounded-2xl border-border/50">
    <CardContent className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-20" />
      <Skeleton className="h-3 w-32" />
    </CardContent>
  </Card>
);

export const TableRowSkeleton = ({ cols = 5 }: { cols?: number }) => (
  <div
    className="flex items-center gap-4 px-4 py-3 border-b border-border/30"
    role="status"
    aria-label="Loading row"
  >
    {Array.from({ length: cols }).map((_, i) => (
      <Skeleton key={i} className={i === 0 ? 'h-4 w-32' : 'h-4 flex-1'} />
    ))}
  </div>
);

export const ListSkeleton = ({
  count = 4,
  Variant = TicketCardSkeleton,
}: {
  count?: number;
  Variant?: React.ComponentType;
}) => (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading items">
    {Array.from({ length: count }).map((_, i) => (
      <Variant key={i} />
    ))}
    <span className="sr-only">Loading…</span>
  </div>
);
