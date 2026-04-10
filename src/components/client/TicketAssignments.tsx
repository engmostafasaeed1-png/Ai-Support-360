import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Users, Plus, UserPlus, Crown, Shield, Eye, Handshake, UserCheck,
  Loader2, Trash2, MoreVertical,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

interface Assignment {
  id: string;
  consultant_id: string;
  role: string;
  work_mode: string;
  status: string;
  notes: string | null;
  created_at: string;
  consultant_name: string;
  avatar_url: string | null;
}

const roleIcons: Record<string, typeof Crown> = {
  lead: Crown,
  support: Shield,
  observer: Eye,
};

const roleColors: Record<string, string> = {
  lead: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  support: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  observer: 'bg-muted text-muted-foreground',
};

const workModeIcons: Record<string, typeof Handshake> = {
  collaborative: Handshake,
  individual: UserCheck,
};

function useTicketAssignments(ticketId: string) {
  return useQuery({
    queryKey: ['ticket-assignments', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_assignments')
        .select('id, consultant_id, role, work_mode, status, notes, created_at')
        .eq('ticket_id', ticketId)
        .eq('status', 'active')
        .order('created_at', { ascending: true });
      if (error) throw error;

      const assignments: Assignment[] = [];
      for (const a of data || []) {
        let consultant_name = 'Unknown';
        let avatar_url: string | null = null;
        const { data: c } = await supabase
          .from('consultants')
          .select('user_id')
          .eq('id', a.consultant_id)
          .single();
        if (c) {
          const { data: p } = await supabase
            .from('profiles')
            .select('display_name, avatar_url')
            .eq('user_id', c.user_id)
            .single();
          if (p) {
            consultant_name = p.display_name || 'Unknown';
            avatar_url = p.avatar_url;
          }
        }
        assignments.push({ ...a, consultant_name, avatar_url });
      }
      return assignments;
    },
  });
}

function useAvailableConsultants(ticketId: string) {
  return useQuery({
    queryKey: ['available-consultants-for-assignment', ticketId],
    queryFn: async () => {
      // Get already assigned consultant IDs
      const { data: assigned } = await supabase
        .from('ticket_assignments')
        .select('consultant_id')
        .eq('ticket_id', ticketId)
        .eq('status', 'active');
      const assignedIds = (assigned || []).map(a => a.consultant_id);

      // Get all verified consultants
      const { data: consultants } = await supabase
        .from('consultants')
        .select('id, user_id')
        .eq('verification_status', 'verified');

      const results: { id: string; name: string; avatar_url: string | null }[] = [];
      for (const c of consultants || []) {
        if (assignedIds.includes(c.id)) continue;
        const { data: p } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('user_id', c.user_id)
          .single();
        results.push({
          id: c.id,
          name: p?.display_name || 'Unknown',
          avatar_url: p?.avatar_url || null,
        });
      }
      return results;
    },
  });
}

interface TicketAssignmentsProps {
  ticketId: string;
  isReadOnly?: boolean;
}

export default function TicketAssignments({ ticketId, isReadOnly }: TicketAssignmentsProps) {
  const { data: assignments, isLoading } = useTicketAssignments(ticketId);
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();

  const handleRemove = async (assignmentId: string) => {
    const { error } = await supabase
      .from('ticket_assignments')
      .update({ status: 'removed' as any })
      .eq('id', assignmentId);
    if (error) { toast.error('Failed to remove'); return; }
    toast.success('Consultant removed');
    queryClient.invalidateQueries({ queryKey: ['ticket-assignments', ticketId] });
  };

  const handleRoleChange = async (assignmentId: string, role: string) => {
    const { error } = await supabase
      .from('ticket_assignments')
      .update({ role: role as any })
      .eq('id', assignmentId);
    if (error) { toast.error('Failed to update role'); return; }
    toast.success('Role updated');
    queryClient.invalidateQueries({ queryKey: ['ticket-assignments', ticketId] });
  };

  const handleWorkModeChange = async (assignmentId: string, mode: string) => {
    const { error } = await supabase
      .from('ticket_assignments')
      .update({ work_mode: mode as any })
      .eq('id', assignmentId);
    if (error) { toast.error('Failed to update'); return; }
    toast.success('Work mode updated');
    queryClient.invalidateQueries({ queryKey: ['ticket-assignments', ticketId] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Assigned Consultants</span>
          {assignments && assignments.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{assignments.length}</Badge>
          )}
        </div>
        {!isReadOnly && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setAddOpen(true)}>
            <Plus className="w-3 h-3" /> Assign
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : assignments && assignments.length > 0 ? (
        <div className="space-y-2">
          {assignments.map(a => {
            const RoleIcon = roleIcons[a.role] || Shield;
            const WorkIcon = workModeIcons[a.work_mode] || Handshake;
            return (
              <Card key={a.id} className="rounded-xl border-border/30">
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={a.avatar_url || undefined} />
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {a.consultant_name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{a.consultant_name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <Badge variant="secondary" className={`text-[9px] px-1.5 py-0 gap-0.5 ${roleColors[a.role]}`}>
                          <RoleIcon className="w-2.5 h-2.5" /> {a.role}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 gap-0.5">
                          <WorkIcon className="w-2.5 h-2.5" /> {a.work_mode}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      {a.notes && (
                        <p className="text-[11px] text-muted-foreground mt-1 italic">"{a.notes}"</p>
                      )}
                    </div>
                    {!isReadOnly && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                            <MoreVertical className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => handleRoleChange(a.id, 'lead')}>
                            <Crown className="w-3.5 h-3.5 me-2" /> Set as Lead
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleRoleChange(a.id, 'support')}>
                            <Shield className="w-3.5 h-3.5 me-2" /> Set as Support
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleRoleChange(a.id, 'observer')}>
                            <Eye className="w-3.5 h-3.5 me-2" /> Set as Observer
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleWorkModeChange(a.id, a.work_mode === 'collaborative' ? 'individual' : 'collaborative')}>
                            {a.work_mode === 'collaborative' ? (
                              <><UserCheck className="w-3.5 h-3.5 me-2" /> Switch to Individual</>
                            ) : (
                              <><Handshake className="w-3.5 h-3.5 me-2" /> Switch to Collaborative</>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => handleRemove(a.id)}>
                            <Trash2 className="w-3.5 h-3.5 me-2" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="rounded-xl border-border/30">
          <CardContent className="py-6 text-center">
            <Users className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No consultants assigned</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Assign one or more consultants to this ticket</p>
          </CardContent>
        </Card>
      )}

      <AddAssignmentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        ticketId={ticketId}
      />
    </div>
  );
}

function AddAssignmentDialog({
  open, onOpenChange, ticketId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ticketId: string;
}) {
  const { data: consultants, isLoading } = useAvailableConsultants(ticketId);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    consultant_id: '',
    role: 'support',
    work_mode: 'collaborative',
    notes: '',
  });

  const handleAssign = async () => {
    if (!form.consultant_id) { toast.error('Select a consultant'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('ticket_assignments').insert({
        ticket_id: ticketId,
        consultant_id: form.consultant_id,
        role: form.role as any,
        work_mode: form.work_mode as any,
        assigned_by: user?.id || null,
        notes: form.notes.trim() || null,
      });
      if (error) throw error;
      toast.success('Consultant assigned');
      queryClient.invalidateQueries({ queryKey: ['ticket-assignments', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['available-consultants-for-assignment', ticketId] });
      setForm({ consultant_id: '', role: 'support', work_mode: 'collaborative', notes: '' });
      onOpenChange(false);
    } catch {
      toast.error('Failed to assign consultant');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-primary" /> Assign Consultant
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Consultant</Label>
            {isLoading ? (
              <Skeleton className="h-10 rounded-md" />
            ) : consultants && consultants.length > 0 ? (
              <Select value={form.consultant_id} onValueChange={v => setForm(f => ({ ...f, consultant_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select consultant..." /></SelectTrigger>
                <SelectContent>
                  {consultants.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={c.avatar_url || undefined} />
                          <AvatarFallback className="text-[8px]">{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        {c.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">No available consultants to assign</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead"><div className="flex items-center gap-1.5"><Crown className="w-3 h-3" /> Lead</div></SelectItem>
                  <SelectItem value="support"><div className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> Support</div></SelectItem>
                  <SelectItem value="observer"><div className="flex items-center gap-1.5"><Eye className="w-3 h-3" /> Observer</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Work Mode</Label>
              <Select value={form.work_mode} onValueChange={v => setForm(f => ({ ...f, work_mode: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="collaborative"><div className="flex items-center gap-1.5"><Handshake className="w-3 h-3" /> Together</div></SelectItem>
                  <SelectItem value="individual"><div className="flex items-center gap-1.5"><UserCheck className="w-3 h-3" /> Individual</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Assignment instructions..."
              rows={2}
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleAssign} disabled={saving || !form.consultant_id} className="gradient-primary border-0">
            {saving && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
