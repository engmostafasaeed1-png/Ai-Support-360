import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Plus, Upload, Eye, EyeOff, Trash2, FileText, Link2, Search, Network } from 'lucide-react';
import { format } from 'date-fns';

const CATEGORIES = ['General', 'Finance', 'HR', 'Supply Chain', 'Manufacturing', 'Sales', 'Procurement', 'Warehouse', 'Quality', 'Plant Maintenance'];
const SAP_MODULES = ['SAP FI', 'SAP CO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP QM', 'SAP PM', 'SAP HR', 'SAP WM', 'SAP PS', 'SAP ABAP', 'SAP Basis', 'SAP BW', 'SAP HANA', 'S/4HANA', 'SAP SuccessFactors'];

export default function BusinessProcessesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');

  const { data: processes = [], isLoading } = useQuery({
    queryKey: ['business-processes'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('business_processes')
        .select('*')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const toggleVisibility = useMutation({
    mutationFn: async ({ id, visible }: { id: string; visible: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('business_processes')
        .update({
          consultant_visible: visible,
          approved_at: visible ? new Date().toISOString() : null,
          approved_by: visible ? user?.id : null,
        } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-processes'] });
      toast.success('Visibility updated');
    },
  });

  const deleteProcess = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('business_processes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-processes'] });
      toast.success('Process deleted');
    },
  });

  const filtered = processes.filter((p: any) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase());
    const matchCat = filterCategory === 'all' || p.category === filterCategory;
    return matchSearch && matchCat;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Business Processes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and document your business processes. Link them to tickets for better tracking.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gradient-primary border-0 gap-1.5">
          <Plus className="w-4 h-4" /> Add Process
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search processes..." value={search} onChange={e => setSearch(e.target.value)} className="ps-9" />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-12 text-center">
            <Network className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No business processes found. Add your first one!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((proc: any) => (
            <Card key={proc.id} className="rounded-2xl hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-foreground">{proc.name}</h3>
                    <Badge variant="secondary" className="text-[10px]">{proc.category}</Badge>
                    {proc.sap_module && <Badge variant="outline" className="text-[10px]">{proc.sap_module}</Badge>}
                    <Badge variant={proc.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">{proc.status}</Badge>
                  </div>
                  {proc.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{proc.description}</p>}
                  {proc.process_owner && <p className="text-xs text-muted-foreground mt-1">Owner: {proc.process_owner}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">Added {format(new Date(proc.created_at), 'MMM d, yyyy')}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-2">
                    {proc.consultant_visible ? <Eye className="w-4 h-4 text-green-500" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                    <Switch
                      checked={proc.consultant_visible}
                      onCheckedChange={(v) => toggleVisibility.mutate({ id: proc.id, visible: v })}
                    />
                    <span className="text-xs text-muted-foreground">{proc.consultant_visible ? 'Visible' : 'Hidden'}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteProcess.mutate(proc.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddProcessDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function AddProcessDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('manual');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [sapModule, setSapModule] = useState('');
  const [processOwner, setProcessOwner] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const reset = () => {
    setName(''); setDescription(''); setCategory('General'); setSapModule(''); setProcessOwner(''); setTags(''); setFile(null); setBulkText('');
  };

  const handleAddManual = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('business_processes').insert({
        client_id: user.id,
        name: name.trim(),
        description: description.trim() || null,
        category,
        sap_module: sapModule || null,
        process_owner: processOwner.trim() || null,
        tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : null,
      } as any);
      if (error) throw error;
      toast.success('Business process added');
      queryClient.invalidateQueries({ queryKey: ['business-processes'] });
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error(e.message || 'Failed to add');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async () => {
    if (!file) { toast.error('Select a file'); return; }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Parse CSV/text file
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { toast.error('File must have header + at least 1 row'); return; }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('process'));
      const descIdx = headers.findIndex(h => h.includes('desc'));
      const catIdx = headers.findIndex(h => h.includes('categ'));
      const modIdx = headers.findIndex(h => h.includes('module') || h.includes('sap'));
      const ownerIdx = headers.findIndex(h => h.includes('owner'));

      if (nameIdx === -1) { toast.error('File must have a "name" column'); setUploading(false); return; }

      const rows = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim());
        return {
          client_id: user.id,
          name: cols[nameIdx] || 'Unnamed',
          description: descIdx >= 0 ? cols[descIdx] || null : null,
          category: catIdx >= 0 ? cols[catIdx] || 'General' : 'General',
          sap_module: modIdx >= 0 ? cols[modIdx] || null : null,
          process_owner: ownerIdx >= 0 ? cols[ownerIdx] || null : null,
        };
      }).filter(r => r.name && r.name !== 'Unnamed');

      if (rows.length === 0) { toast.error('No valid rows found'); setUploading(false); return; }

      const { error } = await supabase.from('business_processes').insert(rows as any);
      if (error) throw error;

      toast.success(`${rows.length} processes imported`);
      queryClient.invalidateQueries({ queryKey: ['business-processes'] });
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error(e.message || 'Import failed');
    } finally {
      setUploading(false);
    }
  };

  const handleBulkAdd = async () => {
    if (!bulkText.trim()) { toast.error('Enter process names'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const names = bulkText.split('\n').map(n => n.trim()).filter(Boolean);
      const rows = names.map(n => ({ client_id: user.id, name: n, category }));
      const { error } = await supabase.from('business_processes').insert(rows as any);
      if (error) throw error;
      toast.success(`${names.length} processes added`);
      queryClient.invalidateQueries({ queryKey: ['business-processes'] });
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error(e.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Network className="w-5 h-5 text-primary" /> Add Business Process</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="manual" className="flex-1">Manual</TabsTrigger>
            <TabsTrigger value="bulk" className="flex-1">Bulk Add</TabsTrigger>
            <TabsTrigger value="upload" className="flex-1">Upload CSV</TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="space-y-3 mt-3">
            <div className="space-y-1.5">
              <Label>Process Name *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Order to Cash" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the business process..." rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>SAP Module</Label>
                <Select value={sapModule} onValueChange={setSapModule}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>{SAP_MODULES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Process Owner</Label>
              <Input value={processOwner} onChange={e => setProcessOwner(e.target.value)} placeholder="Name or department" />
            </div>
            <div className="space-y-1.5">
              <Label>Tags (comma separated)</Label>
              <Input value={tags} onChange={e => setTags(e.target.value)} placeholder="critical, automated, manual" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleAddManual} disabled={saving} className="gradient-primary border-0">
                {saving ? 'Adding...' : 'Add Process'}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-3 mt-3">
            <div className="space-y-1.5">
              <Label>Category for all</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Process Names (one per line)</Label>
              <Textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={8} placeholder={"Order to Cash\nProcure to Pay\nRecord to Report\nHire to Retire"} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleBulkAdd} disabled={saving} className="gradient-primary border-0">
                {saving ? 'Adding...' : 'Add All'}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="upload" className="space-y-3 mt-3">
            <p className="text-sm text-muted-foreground">Upload a CSV file with columns: <strong>name</strong>, description, category, sap_module, owner</p>
            <Input type="file" accept=".csv,.txt" onChange={e => setFile(e.target.files?.[0] || null)} />
            {file && <p className="text-xs text-muted-foreground">Selected: {file.name}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleUpload} disabled={uploading || !file} className="gradient-primary border-0 gap-1.5">
                <Upload className="w-4 h-4" /> {uploading ? 'Importing...' : 'Import'}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
