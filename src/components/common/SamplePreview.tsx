import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

/** A notice that says that a page (or a part of it) shows example data that is not the user's own. */
export function SamplePreviewNote({ what }: { what: string }) {
  return (
    <div role="note" className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div>
        <p className="font-semibold text-foreground">Preview with example data</p>
        <p className="text-muted-foreground">{what} Nothing on this page is saved.</p>
      </div>
    </div>
  );
}

/** Example content that can be read but not used: nothing inside can be clicked, so no button pretends to work. */
export default function SamplePreview({ children }: { children: ReactNode }) {
  return (
    <div className="select-none" {...({ inert: '' } as Record<string, string>)}>
      {children}
    </div>
  );
}
