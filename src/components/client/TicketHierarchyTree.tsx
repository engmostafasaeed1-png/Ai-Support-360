import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  GitBranch, ChevronRight, ChevronDown, Pencil, ExternalLink,
  Network, Circle,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface TreeNode {
  id: string;
  title: string;
  status: string;
  urgency: string;
  sap_module: string;
  children: TreeNode[];
}

const urgencyDot: Record<string, string> = {
  low: 'bg-muted-foreground/40',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
};

const statusBg: Record<string, string> = {
  new: 'border-accent/40 bg-accent/5',
  under_review: 'border-indigo-400/40 bg-indigo-50/50 dark:bg-indigo-950/20',
  matched: 'border-purple-400/40 bg-purple-50/50 dark:bg-purple-950/20',
  in_progress: 'border-blue-400/40 bg-blue-50/50 dark:bg-blue-950/20',
  waiting_for_client: 'border-amber-400/40 bg-amber-50/50 dark:bg-amber-950/20',
  resolved: 'border-green-400/40 bg-green-50/50 dark:bg-green-950/20',
  closed: 'border-border bg-muted/30',
};

// Recursively fetch the full tree starting from a root ticket
async function fetchTree(ticketId: string): Promise<TreeNode> {
  const { data } = await supabase
    .from('tickets')
    .select('id, title, status, urgency, sap_module')
    .eq('id', ticketId)
    .single();

  if (!data) return { id: ticketId, title: 'Unknown', status: 'new', urgency: 'medium', sap_module: '', children: [] };

  const { data: kids } = await supabase
    .from('tickets')
    .select('id')
    .eq('parent_ticket_id', ticketId)
    .order('created_at', { ascending: true });

  const children: TreeNode[] = [];
  for (const kid of kids || []) {
    children.push(await fetchTree(kid.id));
  }

  return {
    id: data.id,
    title: data.title,
    status: data.status || 'new',
    urgency: data.urgency || 'medium',
    sap_module: data.sap_module,
    children,
  };
}

// Walk up to find root ticket
async function findRoot(ticketId: string): Promise<string> {
  let current = ticketId;
  for (let i = 0; i < 20; i++) {
    const { data } = await supabase
      .from('tickets')
      .select('id, parent_ticket_id')
      .eq('id', current)
      .single();
    if (!data || !(data as any).parent_ticket_id) return current;
    current = (data as any).parent_ticket_id;
  }
  return current;
}

function useTicketTree(ticketId: string) {
  return useQuery({
    queryKey: ['ticket-tree', ticketId],
    queryFn: async () => {
      const rootId = await findRoot(ticketId);
      return fetchTree(rootId);
    },
  });
}

function countNodes(node: TreeNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

interface TicketHierarchyTreeProps {
  ticketId: string;
  onEditTicket?: (id: string) => void;
}

export default function TicketHierarchyTree({ ticketId, onEditTicket }: TicketHierarchyTreeProps) {
  const { data: tree, isLoading } = useTicketTree(ticketId);

  if (isLoading) return <Skeleton className="h-40 rounded-xl" />;
  if (!tree) return null;

  const total = countNodes(tree);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Network className="w-3.5 h-3.5" />
        <span>{total} ticket{total !== 1 ? 's' : ''} in hierarchy</span>
      </div>
      <div className="relative">
        <TreeNodeCard node={tree} currentId={ticketId} depth={0} onEdit={onEditTicket} />
      </div>
    </div>
  );
}

function TreeNodeCard({
  node,
  currentId,
  depth,
  onEdit,
}: {
  node: TreeNode;
  currentId: string;
  depth: number;
  onEdit?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const location = useLocation();
  const basePath = location.pathname.startsWith('/admin')
    ? '/admin/tickets'
    : location.pathname.startsWith('/consultant')
    ? '/consultant/tickets'
    : '/client/tickets';
  const isCurrent = node.id === currentId;
  const hasChildren = node.children.length > 0;

  return (
    <div className={cn('relative', depth > 0 && 'ms-5 mt-2')}>
      {/* Connector line */}
      {depth > 0 && (
        <div className="absolute -left-4 top-0 h-5 w-4 border-l-2 border-b-2 border-border/50 rounded-bl-lg" />
      )}

      {/* Node */}
      <div
        className={cn(
          'relative rounded-xl border-2 p-3 transition-all',
          isCurrent
            ? 'border-primary/60 bg-primary/5 ring-2 ring-primary/20 shadow-sm'
            : statusBg[node.status] || 'border-border bg-card',
        )}
      >
        <div className="flex items-center gap-2">
          {/* Expand toggle */}
          {hasChildren ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-muted transition-colors shrink-0"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
              )}
            </button>
          ) : (
            <Circle className="w-2 h-2 text-muted-foreground/30 ms-1.5 me-1.5 shrink-0" />
          )}

          {/* Urgency dot */}
          <span className={cn('w-2 h-2 rounded-full shrink-0', urgencyDot[node.urgency])} />

          {/* Title */}
          <p className={cn(
            'text-sm font-medium truncate flex-1 min-w-0',
            isCurrent ? 'text-primary font-semibold' : 'text-foreground',
          )}>
            {node.title}
          </p>

          {/* Status */}
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0 capitalize">
            {node.status.replace(/_/g, ' ')}
          </Badge>

          {/* Actions */}
          <div className="flex items-center gap-0.5 shrink-0">
            {onEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => { e.stopPropagation(); onEdit(node.id); }}
                title="Edit"
              >
                <Pencil className="w-3 h-3" />
              </Button>
            )}
            {!isCurrent && (
              <Link to={`${basePath}/${node.id}`} onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Open">
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 mt-1 ms-7 text-[10px] text-muted-foreground">
          <span>{node.sap_module}</span>
          {hasChildren && (
            <span className="flex items-center gap-0.5">
              <GitBranch className="w-2.5 h-2.5" /> {node.children.length}
            </span>
          )}
          {isCurrent && <Badge className="text-[8px] px-1 py-0 bg-primary text-primary-foreground">Current</Badge>}
        </div>
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div className="relative">
          {/* Vertical connector */}
          {node.children.length > 0 && (
            <div className="absolute left-1 top-0 bottom-2 w-0 border-l-2 border-border/30" />
          )}
          {node.children.map((child) => (
            <TreeNodeCard key={child.id} node={child} currentId={currentId} depth={depth + 1} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  );
}
