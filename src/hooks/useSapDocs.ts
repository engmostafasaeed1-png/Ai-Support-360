import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { SapDocSource } from '@/lib/sapDocsAdmin';

const db = supabase as any;
const QUERY_KEY = ['sap-doc-sources'];
const MAX_STEPS = 3000;

/** The documentation sources and the state of their imports (administrators only; the database refuses everybody else). */
export function useSapDocSources() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<SapDocSource[]> => {
      const { data, error } = await db.from('sap_doc_sources').select('*').order('title', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as SapDocSource[];
    },
  });
}

/** The switch "use in suggestions". The database allows it only for a source that has been imported. */
export function useSetDocSourceEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; enabled: boolean }) => {
      const { error } = await db.from('sap_doc_sources').update({ enabled: v.enabled }).eq('id', v.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success('Saved');
    },
    onError: (e: Error) => toast.error(e.message || 'Could not save'),
  });
}

interface ImportAnswer {
  ok?: boolean;
  done?: boolean;
  error?: string;
}

async function callImport(action: 'start' | 'step' | 'remove', sourceId: string): Promise<ImportAnswer> {
  const { data, error } = await supabase.functions.invoke('sap-docs-import', { body: { action, source_id: sourceId } });
  if (error) throw new Error('The import service did not answer. Please try again.');
  return (data ?? {}) as ImportAnswer;
}

/** Runs an import page by page (the server does a few pages per call) and removes an import. `busy` is the source that is being worked on. */
export function useDocImport() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const stop = useRef(false);
  const running = useRef(false);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: QUERY_KEY }), [qc]);

  /** "import" reads the page list and empties the old import first; "continue" goes on where an import stopped. */
  const run = useCallback(async (sourceId: string, mode: 'import' | 'continue') => {
    if (running.current) return;
    running.current = true;
    stop.current = false;
    setStopping(false);
    setBusy(sourceId);
    try {
      if (mode === 'import') {
        const first = await callImport('start', sourceId);
        await refresh();
        if (first.ok === false || first.error) {
          toast.error(first.error ?? 'The import could not start');
          return;
        }
      }
      for (let i = 0; i < MAX_STEPS; i++) {
        if (stop.current) {
          toast.info('Stopped. Press Continue to go on.');
          return;
        }
        const answer = await callImport('step', sourceId);
        await refresh();
        if (answer.ok === false || answer.error) {
          toast.error(answer.error ?? 'The import stopped');
          return;
        }
        if (answer.done) {
          toast.success('The documentation is imported. Switch it on to use it in suggestions.');
          return;
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The import stopped');
      await refresh();
    } finally {
      running.current = false;
      setBusy(null);
      setStopping(false);
    }
  }, [refresh]);

  const remove = useCallback(async (sourceId: string) => {
    if (running.current) return;
    running.current = true;
    setBusy(sourceId);
    try {
      const answer = await callImport('remove', sourceId);
      await refresh();
      if (answer.ok === false || answer.error) toast.error(answer.error ?? 'Could not remove it');
      else toast.success('Removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove it');
    } finally {
      running.current = false;
      setBusy(null);
    }
  }, [refresh]);

  const cancel = useCallback(() => {
    stop.current = true;
    setStopping(true);
  }, []);

  return { busy, stopping, run, remove, cancel };
}
