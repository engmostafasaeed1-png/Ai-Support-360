import { ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { FREE_SAP_SOURCES } from '@/lib/sapSources';

/** Links to SAP's own free websites. Nothing from them is copied: the reader opens them in a new tab. */
export default function FreeSapSources() {
  return (
    <Card className="rounded-2xl border-border/50" data-testid="free-sap-sources">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold">Official SAP websites, free to open</p>
          <p className="text-xs text-muted-foreground">SAP's own websites. No SAP login is needed. Each one opens in a new tab.</p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {FREE_SAP_SOURCES.map(s => (
            <li key={s.id}>
              <a href={s.home} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 rounded-xl border border-border/50 p-3 hover:bg-accent/10">
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-primary">{s.name}</span>
                  <span className="block text-xs text-muted-foreground">{s.what}</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">SAP Notes are on SAP for Me and need your own SAP login. We never ask for it.</p>
      </CardContent>
    </Card>
  );
}
