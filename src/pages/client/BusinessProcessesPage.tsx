import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
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
import { toast } from 'sonner';
import { Plus, Upload, Eye, EyeOff, Trash2, Search, Network, ChevronRight, ChevronDown, CornerDownRight } from 'lucide-react';
import { format } from 'date-fns';

const CATEGORIES = ['General', 'Finance', 'HR', 'Supply Chain', 'Manufacturing', 'Sales', 'Procurement', 'Warehouse', 'Quality', 'Plant Maintenance'];
const SAP_MODULES = ['SAP FI', 'SAP CO', 'SAP MM', 'SAP SD', 'SAP PP', 'SAP QM', 'SAP PM', 'SAP HR', 'SAP WM', 'SAP PS', 'SAP ABAP', 'SAP Basis', 'SAP BW', 'SAP HANA', 'S/4HANA', 'SAP SuccessFactors'];
const LEVEL_COLORS = ['bg-primary', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500'];
const LEVEL_LABELS = ['L1', 'L2', 'L3', 'L4'];

interface BPNode {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sap_module: string | null;
  process_owner: string | null;
  status: string;
  consultant_visible: boolean;
  created_at: string;
  parent_id: string | null;
  level: number;
  tags: string[] | null;
  children: BPNode[];
}

function buildTree(processes: any[]): BPNode[] {
  const map = new Map<string, BPNode>();
  processes.forEach(p => map.set(p.id, { ...p, children: [] }));
  const roots: BPNode[] = [];
  processes.forEach(p => {
    const node = map.get(p.id)!;
    if (p.parent_id && map.has(p.parent_id)) {
      map.get(p.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function filterTree(nodes: BPNode[], search: string, category: string): BPNode[] {
  return nodes
    .map(n => {
      const filteredChildren = filterTree(n.children, search, category);
      const matchSearch = !search || n.name.toLowerCase().includes(search.toLowerCase()) || n.description?.toLowerCase().includes(search.toLowerCase());
      const matchCat = category === 'all' || n.category === category;
      if ((matchSearch && matchCat) || filteredChildren.length > 0) {
        return { ...n, children: filteredChildren };
      }
      return null;
    })
    .filter(Boolean) as BPNode[];
}

export default function BusinessProcessesPage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [addParent, setAddParent] = useState<{ id: string; name: string; level: number } | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: processes = [], isLoading } = useQuery({
    queryKey: ['business-processes'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('business_processes')
        .select('*')
        .eq('client_id', user.id)
        .order('level', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const tree = useMemo(() => buildTree(processes), [processes]);
  const filtered = useMemo(() => filterTree(tree, search, filterCategory), [tree, search, filterCategory]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(processes.map((p: any) => p.id)));
  const collapseAll = () => setExpanded(new Set());

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

  const handleAddSub = (parent: BPNode) => {
    if (parent.level >= 4) {
      toast.error('Maximum 4 levels allowed');
      return;
    }
    setAddParent({ id: parent.id, name: parent.name, level: parent.level });
    setAddOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Business Processes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Manage hierarchical business processes (L1→L2→L3→L4).</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>Expand All</Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>Collapse All</Button>
          <Button onClick={() => { setAddParent(null); setAddOpen(true); }} className="gradient-primary border-0 gap-1.5">
            <Plus className="w-4 h-4" /> Add L1 Process
          </Button>
        </div>
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
        <div className="space-y-1">
          {filtered.map(node => (
            <ProcessNode
              key={node.id}
              node={node}
              expanded={expanded}
              onToggle={toggleExpand}
              onToggleVisibility={(id, v) => toggleVisibility.mutate({ id, visible: v })}
              onDelete={(id) => deleteProcess.mutate(id)}
              onAddSub={handleAddSub}
            />
          ))}
        </div>
      )}

      <AddProcessDialog
        open={addOpen}
        onOpenChange={(v) => { setAddOpen(v); if (!v) setAddParent(null); }}
        parentInfo={addParent}
        allProcesses={processes}
      />
    </div>
  );
}

function ProcessNode({
  node, expanded, onToggle, onToggleVisibility, onDelete, onAddSub, depth = 0,
}: {
  node: BPNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onToggleVisibility: (id: string, v: boolean) => void;
  onDelete: (id: string) => void;
  onAddSub: (node: BPNode) => void;
  depth?: number;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const levelColor = LEVEL_COLORS[Math.min(node.level - 1, 3)];
  const levelLabel = LEVEL_LABELS[Math.min(node.level - 1, 3)];

  return (
    <div>
      <Card className="rounded-xl hover:shadow-md transition-shadow" style={{ marginLeft: depth * 24 }}>
        <CardContent className="p-3 flex items-center gap-2">
          {/* Expand/collapse */}
          <button
            onClick={() => hasChildren && onToggle(node.id)}
            className={`w-6 h-6 flex items-center justify-center rounded shrink-0 ${hasChildren ? 'hover:bg-muted cursor-pointer' : 'opacity-30'}`}
            disabled={!hasChildren}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
            ) : (
              <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </button>

          {/* Level badge */}
          <span className={`${levelColor} text-white text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0`}>
            {levelLabel}
          </span>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground text-sm">{node.name}</h3>
              {node.category && <Badge variant="secondary" className="text-[10px]">{node.category}</Badge>}
              {node.sap_module && <Badge variant="outline" className="text-[10px]">{node.sap_module}</Badge>}
            </div>
            {node.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{node.description}</p>}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {node.level < 4 && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-muted-foreground" onClick={() => onAddSub(node)}>
                <Plus className="w-3 h-3" /> Sub
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              {node.consultant_visible ? <Eye className="w-3.5 h-3.5 text-green-500" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
              <Switch
                checked={node.consultant_visible}
                onCheckedChange={(v) => onToggleVisibility(node.id, v)}
                className="scale-75"
              />
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(node.id)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="mt-1 space-y-1">
          {node.children.map(child => (
            <ProcessNode
              key={child.id}
              node={child}
              expanded={expanded}
              onToggle={onToggle}
              onToggleVisibility={onToggleVisibility}
              onDelete={onDelete}
              onAddSub={onAddSub}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddProcessDialog({
  open, onOpenChange, parentInfo, allProcesses,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  parentInfo: { id: string; name: string; level: number } | null;
  allProcesses: any[];
}) {
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

  const newLevel = parentInfo ? parentInfo.level + 1 : 1;

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
        parent_id: parentInfo?.id || null,
        level: newLevel,
      } as any);
      if (error) throw error;
      toast.success(`${LEVEL_LABELS[newLevel - 1]} process added`);
      queryClient.invalidateQueries({ queryKey: ['business-processes'] });
      onOpenChange(false);
      reset();
    } catch (e: any) {
      toast.error(e.message || 'Failed to add');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkAdd = async () => {
    if (!bulkText.trim()) { toast.error('Enter process names'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const names = bulkText.split('\n').map(n => n.trim()).filter(Boolean);
      const rows = names.map(n => ({
        client_id: user.id,
        name: n,
        category,
        parent_id: parentInfo?.id || null,
        level: newLevel,
      }));
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

  const handleUpload = async () => {
    if (!file) { toast.error('Select a file'); return; }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
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
          parent_id: parentInfo?.id || null,
          level: newLevel,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            Add {LEVEL_LABELS[newLevel - 1]} Process
          </DialogTitle>
        </DialogHeader>

        {parentInfo && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 text-sm">
            <CornerDownRight className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Under:</span>
            <span className="font-medium text-foreground">{parentInfo.name}</span>
            <Badge variant="secondary" className="text-[10px]">{LEVEL_LABELS[parentInfo.level - 1]}</Badge>
          </div>
        )}

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
                {saving ? 'Adding...' : `Add ${LEVEL_LABELS[newLevel - 1]} Process`}
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
