import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/** Title and description above a console section. */
export function SectionShell({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
          <Icon aria-hidden="true" className="h-5 w-5 text-primary" /> {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** A section whose real tool lives on its own page. */
export function LinkCard({ to, label, cta = 'Open full page' }: { to: string; label: string; cta?: string }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to={to}>{cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** One line of a facts card: label on the left, value on the right. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-end font-medium text-foreground">{children}</span>
    </div>
  );
}
