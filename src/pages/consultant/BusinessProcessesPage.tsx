import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Network, ChevronRight, ChevronDown, CornerDownRight } from 'lucide-react';

const LEVEL_COLORS = ['bg-primary', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500'];
const LEVEL_LABELS = ['L1', 'L2', 'L3', 'L4'];

interface BPNode {
  id: string; name: string; description: string | null; category: string | null;
  sap_module: string | null; process_owner: string | null; level: number;
  parent_id: string | null; children: BPNode[];
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

export default function ConsultantBusinessProcessesPage() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: processes = [], isLoading } = useQuery({
    queryKey: ['consultant-business-processes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_processes')
        .select('*')
        .eq('consultant_visible', true)
        .order('level', { ascending: true })
        .order('category', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  const tree = useMemo(() => buildTree(processes), [processes]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Client Business Processes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">View approved business processes from your clients.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setExpanded(new Set(processes.map((p: any) => p.id)))}>Expand All</Button>
          <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())}>Collapse</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : tree.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-12 text-center">
            <Network className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No business processes shared with you yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {tree.map(node => (
            <TreeNode key={node.id} node={node} expanded={expanded} onToggle={toggleExpand} />
          ))}
        </div>
      )}
    </div>
  );
}

function TreeNode({ node, expanded, onToggle, depth = 0 }: {
  node: BPNode; expanded: Set<string>; onToggle: (id: string) => void; depth?: number;
}) {
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const levelColor = LEVEL_COLORS[Math.min(node.level - 1, 3)];

  return (
    <div>
      <Card className="rounded-xl" style={{ marginLeft: depth * 24 }}>
        <CardContent className="p-3 flex items-center gap-2">
          <button
            onClick={() => hasChildren && onToggle(node.id)}
            className={`w-6 h-6 flex items-center justify-center rounded shrink-0 ${hasChildren ? 'hover:bg-muted cursor-pointer' : 'opacity-30'}`}
            disabled={!hasChildren}
          >
            {hasChildren ? (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          <span className={`${levelColor} text-white text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0`}>
            {LEVEL_LABELS[Math.min(node.level - 1, 3)]}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground text-sm">{node.name}</h3>
              {node.category && <Badge variant="secondary" className="text-[10px]">{node.category}</Badge>}
              {node.sap_module && <Badge variant="outline" className="text-[10px]">{node.sap_module}</Badge>}
            </div>
            {node.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{node.description}</p>}
            {node.process_owner && <p className="text-[10px] text-muted-foreground">Owner: {node.process_owner}</p>}
          </div>
        </CardContent>
      </Card>
      {hasChildren && isExpanded && (
        <div className="mt-1 space-y-1">
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} expanded={expanded} onToggle={onToggle} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
