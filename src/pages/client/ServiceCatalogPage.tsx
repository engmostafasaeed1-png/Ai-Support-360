import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Package, Search, Clock, DollarSign, CheckCircle, ShoppingCart, ArrowRight } from 'lucide-react';

export default function ServiceCatalogPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [requestItem, setRequestItem] = useState<any>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['catalog-items'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('catalog_items') as any).select('*').eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: myRequests = [] } = useQuery({
    queryKey: ['my-catalog-requests'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await (supabase.from('catalog_requests') as any).select('*, catalog_items(title, icon, category)').eq('requested_by', user.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const categories = ['all', ...new Set(items.map((i: any) => i.category))];
  const filtered = items
    .filter((i: any) => category === 'all' || i.category === category)
    .filter((i: any) => !search || i.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Package className="w-6 h-6 text-primary" /> Service Catalog
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Browse and request pre-built services and support packages.</p>
      </div>

      <Tabs defaultValue="catalog">
        <TabsList><TabsTrigger value="catalog">Catalog</TabsTrigger><TabsTrigger value="requests">My Requests ({myRequests.length})</TabsTrigger></TabsList>
        
        <TabsContent value="catalog" className="space-y-4 mt-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search services..." value={search} onChange={e => setSearch(e.target.value)} className="ps-9 rounded-xl" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {categories.map((c: any) => (
                <Button key={c} size="sm" variant={category === c ? 'default' : 'outline'}
                  className={`text-xs rounded-full h-8 capitalize ${category === c ? 'gradient-primary border-0' : ''}`}
                  onClick={() => setCategory(c)}>
                  {c}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {isLoading ? [1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />) :
              filtered.length === 0 ? (
                <div className="col-span-full text-center py-12">
                  <Package className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No services found.</p>
                </div>
              ) : filtered.map((item: any) => (
                <Card key={item.id} className="rounded-2xl border-border/50 hover:shadow-premium hover:border-accent/30 transition-all group">
                  <CardContent className="p-5 flex flex-col h-full">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground shrink-0">
                        <Package className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground truncate">{item.title}</p>
                        <Badge variant="outline" className="text-[9px] capitalize mt-0.5">{item.category}</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-3 flex-1">{item.description}</p>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/30">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {item.estimated_time && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.estimated_time}</span>}
                        {item.estimated_cost > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />{item.estimated_cost} {item.cost_currency}</span>}
                      </div>
                      <Button size="sm" className="gap-1 text-xs gradient-primary border-0" onClick={() => setRequestItem(item)}>
                        Request <ArrowRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </TabsContent>

        <TabsContent value="requests" className="space-y-3 mt-4">
          {myRequests.length === 0 ? (
            <Card className="rounded-2xl"><CardContent className="py-12 text-center">
              <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No requests yet.</p>
            </CardContent></Card>
          ) : myRequests.map((req: any) => (
            <Card key={req.id} className="rounded-2xl border-border/50">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground text-sm truncate">{req.catalog_items?.title || 'Service'}</p>
                  <p className="text-xs text-muted-foreground">{new Date(req.created_at).toLocaleDateString()}</p>
                </div>
                <Badge variant="secondary" className="text-[10px]">{req.status.replace(/_/g, ' ')}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {requestItem && <RequestDialog item={requestItem} onClose={() => setRequestItem(null)} onCreated={() => queryClient.invalidateQueries({ queryKey: ['my-catalog-requests'] })} />}
    </div>
  );
}

function RequestDialog({ item, onClose, onCreated }: { item: any; onClose: () => void; onCreated: () => void }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await (supabase.from('catalog_requests') as any).insert({
        catalog_item_id: item.id,
        requested_by: user.id,
        notes,
        status: item.requires_approval ? 'pending_approval' : 'submitted',
        approval_status: item.requires_approval ? 'pending' : 'none',
      });
      if (error) throw error;
      toast.success('Request submitted!');
      onClose();
      onCreated();
    } catch { toast.error('Failed to submit'); } finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Request: {item.title}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">{item.description}</p>
          {item.requires_approval && <Badge variant="secondary" className="text-xs">Requires approval</Badge>}
          <div className="space-y-1.5"><label className="text-xs font-medium">Additional Notes</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Any specific requirements..." /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving} className="gradient-primary border-0">Submit Request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
