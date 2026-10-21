import { createContext, Suspense, useContext, useMemo, useState, type ReactNode } from 'react';
import { demoFunnel } from '@/lib/analytics';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import type { DemoType } from './DemoRequestWizard';

// The dialog (calendar, date library, form steps) is a separate download, fetched the first time a visitor opens it.
const DemoRequestWizard = lazyWithRetry(() => import('./DemoRequestWizard'), 'DemoRequestWizard');

type OpenOptions = { source?: string };

type Ctx = {
  open: (initial?: DemoType['id'], opts?: OpenOptions) => void;
};

const DemoWizardContext = createContext<Ctx | null>(null);

export function useDemoWizard(): Ctx {
  const ctx = useContext(DemoWizardContext);
  // Safe fallback so missing provider never crashes the page; logs in dev.
  if (!ctx) {
    return {
      open: () => {
        if (import.meta.env.DEV) {
          console.warn('useDemoWizard called outside <DemoWizardProvider>');
        }
      },
    };
  }
  return ctx;
}

export function DemoWizardProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const [initialType, setInitialType] = useState<DemoType['id'] | undefined>(undefined);
  const [source, setSource] = useState<string>('unknown');

  const value = useMemo<Ctx>(
    () => ({
      open: (initial, opts) => {
        const src = opts?.source ?? 'unknown';
        setInitialType(initial);
        setSource(src);
        setUsed(true);
        setOpen(true);
        // Fire the open event immediately so we capture intent even if
        // the user closes the dialog before any step renders.
        demoFunnel.ctaClick(src, initial);
        demoFunnel.wizardOpen(src, initial);
      },
    }),
    [],
  );

  return (
    <DemoWizardContext.Provider value={value}>
      {children}
      {used && (
        <Suspense fallback={null}>
          <DemoRequestWizard open={open} onOpenChange={setOpen} initialType={initialType} source={source} />
        </Suspense>
      )}
    </DemoWizardContext.Provider>
  );
}
