import { Search } from 'lucide-react';
import { openGlobalSearch } from '@/lib/globalSearch';

interface HeaderSearchButtonProps {
  placeholder: string;
}

/** Looks like a search box and opens the command palette (the same one as Ctrl+K). */
export default function HeaderSearchButton({ placeholder }: HeaderSearchButtonProps) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={openGlobalSearch}
      aria-label={placeholder}
      className="hidden md:flex h-9 w-40 items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 lg:w-56 xl:w-72"
    >
      <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate text-start">{placeholder}</span>
      <kbd className="hidden rounded border border-border/60 bg-card px-1.5 py-0.5 font-mono text-[10px] lg:inline">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
    </button>
  );
}
