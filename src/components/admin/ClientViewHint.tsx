import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { NAME_PRIVACY_STRINGS, pickLang } from '@/lib/consultantName';

type Row = { consultant_id: string; user_id: string; client_view: string | null };
type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = (fn: string, args: Record<string, unknown>): Promise<RpcResult> =>
  (supabase as unknown as { rpc: (f: string, a: Record<string, unknown>) => Promise<RpcResult> }).rpc(fn, args);

// Hints on one screen ask together: ids are collected for one tick and read in one request.
let queue = new Map<string, Array<(v: string | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;
async function flush() {
  const batch = queue;
  queue = new Map();
  timer = null;
  const ids = [...batch.keys()];
  const found = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await rpc('consultant_client_view_names', { _ids: ids.slice(i, i + 500) });
    if (error) break;
    for (const r of (Array.isArray(data) ? data : []) as Row[]) {
      if (!r.client_view) continue;
      found.set(r.consultant_id, r.client_view);
      found.set(r.user_id, r.client_view);
    }
  }
  for (const [id, cbs] of batch) cbs.forEach((cb) => cb(found.get(id) ?? null));
}
export function loadClientViewName(id: string): Promise<string | null> {
  return new Promise((resolve) => {
    const list = queue.get(id) ?? [];
    list.push(resolve);
    queue.set(id, list);
    if (!timer) timer = setTimeout(() => { void flush().catch(() => { /* hint hidden */ }); }, 0);
  });
}

export const isAdminPath = (path: string) => path.startsWith('/admin') || path.startsWith('/super-admin');

/**
 * Admin screens only: "Visible to clients as: M. S****" next to a consultant's full name.
 * The text is the name a neutral viewer receives from the database (administrators only); nothing shows elsewhere,
 * for non-consultants, or before the prepared name privacy SQL is installed.
 */
export default function ClientViewHint({ id, className }: { id: string | null | undefined; className?: string }) {
  const { pathname } = useLocation();
  const { i18n } = useTranslation();
  const ar = !!i18n?.language?.startsWith('ar');
  const enabled = !!id && isAdminPath(pathname);
  const q = useQuery({
    queryKey: ['client-view-name', id],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => loadClientViewName(id as string),
  });
  if (!enabled || !q.data) return null;
  return (
    <span className={cn('block text-[11px] font-normal text-muted-foreground', className)} data-testid="client-view-hint">
      {pickLang(NAME_PRIVACY_STRINGS.adminHint, ar)} <span className="font-semibold" dir="auto">{q.data}</span>
    </span>
  );
}
