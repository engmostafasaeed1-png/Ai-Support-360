import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format } from 'date-fns';

type Filter = 'visible' | 'hidden' | 'all';

interface Row {
  id: string; ticket_id: string; consultant_id: string; client_id: string; score: number;
  communication_score: number | null; clarity_score: number | null; cooperation_score: number | null;
  would_work_again: boolean | null; comment: string | null; hidden: boolean; hidden_reason: string | null; created_at: string;
  clientName: string; consultantName: string; ticketTitle: string;
}

async function loadReviews(): Promise<Row[]> {
  const { data, error } = await (supabase as any).from('client_reviews')
    .select('id, ticket_id, consultant_id, client_id, score, communication_score, clarity_score, cooperation_score, would_work_again, comment, hidden, hidden_reason, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data || []) as any[];
  if (!rows.length) return [];
  const uniq = (a: string[]) => [...new Set(a)];
  const [tickets, consultants, companies] = await Promise.all([
    supabase.from('tickets').select('id, title').in('id', uniq(rows.map(r => r.ticket_id))),
    supabase.from('consultants').select('id, user_id').in('id', uniq(rows.map(r => r.consultant_id))),
    supabase.from('client_profiles').select('user_id, company_name').in('user_id', uniq(rows.map(r => r.client_id))),
  ]);
  const cUser = Object.fromEntries((consultants.data || []).map((c: any) => [c.id, c.user_id]));
  const userIds = uniq([...rows.map(r => r.client_id), ...Object.values(cUser) as string[]]);
  const { data: profiles } = await supabase.from('profile_directory').select('user_id, display_name').in('user_id', userIds);
  const names = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p.display_name]));
  const company = Object.fromEntries((companies.data || []).map((c: any) => [c.user_id, c.company_name]));
  const titles = Object.fromEntries((tickets.data || []).map((t: any) => [t.id, t.title]));
  return rows.map(r => ({
    ...r,
    clientName: names[r.client_id] || company[r.client_id] || 'Client',
    consultantName: names[cUser[r.consultant_id]] || 'Consultant',
    ticketTitle: titles[r.ticket_id] || '',
  }));
}

export default function ClientReviewsPage() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['admin-client-reviews'], queryFn: loadReviews });
  const [filter, setFilter] = useState<Filter>('visible');
  const [search, setSearch] = useState('');
  const [hiding, setHiding] = useState<Row | null>(null);
  const [reason, setReason] = useState('');

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return data.filter(r => (filter === 'all' || (filter === 'hidden') === r.hidden)
      && (!s || r.clientName.toLowerCase().includes(s) || r.consultantName.toLowerCase().includes(s)));
  }, [data, filter, search]);

  const setHidden = async (id: string, hidden: boolean, why?: string) => {
    const { error } = await supabase.rpc('admin_hide_client_review' as any, { _review_id: id, _hidden: hidden, _reason: hidden ? (why ?? null) : null } as any);
    if (error) { toast.error(error.message); return false; }
    await qc.invalidateQueries({ queryKey: ['admin-client-reviews'] });
    return true;
  };

  const v = (n: number | null) => (n === null ? '—' : String(n));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground">Client ratings</h1>
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-sm font-semibold">Ratings of clients by consultants</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={filter} onValueChange={x => setFilter(x as Filter)}>
              <TabsList>
                <TabsTrigger value="visible">Visible</TabsTrigger>
                <TabsTrigger value="hidden">Hidden</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client or consultant" aria-label="Search client or consultant" className="w-56" />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ratings.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead><TableHead>Client</TableHead><TableHead>Consultant</TableHead><TableHead>Request</TableHead>
                  <TableHead>Overall</TableHead><TableHead>Communication</TableHead><TableHead>Clarity of requirements</TableHead><TableHead>Cooperation</TableHead>
                  <TableHead>Would work again</TableHead><TableHead>Comment</TableHead><TableHead>Status</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{format(new Date(r.created_at), 'yyyy-MM-dd')}</TableCell>
                    <TableCell>{r.clientName}</TableCell>
                    <TableCell>{r.consultantName}</TableCell>
                    <TableCell className="max-w-48 truncate">{r.ticketTitle}</TableCell>
                    <TableCell>{r.score}</TableCell>
                    <TableCell>{v(r.communication_score)}</TableCell>
                    <TableCell>{v(r.clarity_score)}</TableCell>
                    <TableCell>{v(r.cooperation_score)}</TableCell>
                    <TableCell>{r.would_work_again === null ? '—' : r.would_work_again ? 'Yes' : 'No'}</TableCell>
                    <TableCell className="max-w-64 whitespace-pre-wrap">{r.comment || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={r.hidden ? 'secondary' : 'outline'}>{r.hidden ? 'Hidden' : 'Visible'}</Badge>
                      {r.hidden && r.hidden_reason && <p className="mt-1 text-xs text-muted-foreground">{r.hidden_reason}</p>}
                    </TableCell>
                    <TableCell>
                      {r.hidden
                        ? <Button size="sm" variant="outline" onClick={() => void setHidden(r.id, false)}>Show again</Button>
                        : <Button size="sm" variant="outline" onClick={() => { setHiding(r); setReason(''); }}>Hide</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!hiding} onOpenChange={o => { if (!o) setHiding(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Hide this rating</DialogTitle></DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="hide-reason">Reason</Label>
            <Textarea id="hide-reason" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setHiding(null)}>Cancel</Button>
            <Button onClick={async () => { if (hiding && await setHidden(hiding.id, true, reason.trim())) setHiding(null); }}>Hide</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
