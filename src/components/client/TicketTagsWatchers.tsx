import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Tag, Plus, X, Eye, EyeOff, Bell, BellOff, Users } from 'lucide-react';

interface Props {
  ticketId: string;
  isReadOnly?: boolean;
}

const TAG_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4'];

export default function TicketTagsWatchers({ ticketId, isReadOnly = false }: Props) {
  const queryClient = useQueryClient();
  const [newTag, setNewTag] = useState('');
  const [adding, setAdding] = useState(false);

  const { data: tags = [], isLoading: tagsLoading } = useQuery({
    queryKey: ['ticket-tags', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_tags')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: watchers = [], isLoading: watchersLoading } = useQuery({
    queryKey: ['ticket-watchers', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_watchers')
        .select('*')
        .eq('ticket_id', ticketId);
      if (error) throw error;

      const userIds = (data || []).map((w: any) => w.user_id);
      if (userIds.length === 0) return [];
      const { data: profiles } = await supabase
        .from('profile_directory')
        .select('user_id, display_name')
        .in('user_id', userIds);
      const nameMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p.display_name || 'Unknown']));

      return (data || []).map((w: any) => ({
        ...w,
        display_name: nameMap[w.user_id] || 'Unknown',
      }));
    },
  });

  const { data: isWatching = false } = useQuery({
    queryKey: ['ticket-watching', ticketId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { data } = await supabase
        .from('ticket_watchers')
        .select('id')
        .eq('ticket_id', ticketId)
        .eq('user_id', user.id)
        .maybeSingle();
      return !!data;
    },
  });

  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      const { error } = await supabase.from('ticket_tags').insert({
        ticket_id: ticketId,
        tag: newTag.trim().toLowerCase(),
        color,
        added_by: user?.id,
      } as any);
      if (error) {
        if (error.code === '23505') toast.error('Tag already exists');
        else throw error;
        return;
      }
      setNewTag('');
      queryClient.invalidateQueries({ queryKey: ['ticket-tags', ticketId] });
    } catch {
      toast.error('Failed to add tag');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    const { error } = await supabase.from('ticket_tags').delete().eq('id', tagId);
    if (error) { toast.error('Failed'); return; }
    queryClient.invalidateQueries({ queryKey: ['ticket-tags', ticketId] });
  };

  const toggleWatch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (isWatching) {
      await supabase.from('ticket_watchers').delete().eq('ticket_id', ticketId).eq('user_id', user.id);
      toast.success('Stopped watching ticket');
    } else {
      await supabase.from('ticket_watchers').insert({ ticket_id: ticketId, user_id: user.id } as any);
      toast.success('Now watching ticket — you\'ll get notifications');
    }
    queryClient.invalidateQueries({ queryKey: ['ticket-watching', ticketId] });
    queryClient.invalidateQueries({ queryKey: ['ticket-watchers', ticketId] });
  };

  return (
    <div className="space-y-4">
      {/* Tags */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
          <Tag className="w-3 h-3" /> Tags
        </p>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t: any) => (
            <Badge key={t.id} variant="secondary" className="text-[10px] gap-1 px-2 py-0.5" style={{ backgroundColor: `${t.color}15`, color: t.color, borderColor: `${t.color}30` }}>
              {t.tag}
              {!isReadOnly && (
                <button onClick={() => handleRemoveTag(t.id)} className="hover:opacity-70">
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </Badge>
          ))}
          {tags.length === 0 && <span className="text-xs text-muted-foreground">No tags</span>}
        </div>
        {!isReadOnly && (
          <div className="flex gap-2">
            <Input
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              placeholder="Add tag..."
              className="h-8 text-xs flex-1"
              onKeyDown={e => e.key === 'Enter' && handleAddTag()}
            />
            <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={handleAddTag} disabled={adding}>
              <Plus className="w-3 h-3" /> Add
            </Button>
          </div>
        )}
      </div>

      {/* Watchers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Users className="w-3 h-3" /> Watchers ({watchers.length})
          </p>
          <Button size="sm" variant={isWatching ? 'default' : 'outline'} className="h-7 text-[10px] gap-1" onClick={toggleWatch}>
            {isWatching ? <BellOff className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
            {isWatching ? 'Unwatch' : 'Watch'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {watchers.map((w: any) => (
            <Badge key={w.id} variant="outline" className="text-[10px] gap-1">
              <Eye className="w-2.5 h-2.5" /> {w.display_name}
            </Badge>
          ))}
          {watchers.length === 0 && <span className="text-xs text-muted-foreground">No watchers</span>}
        </div>
      </div>
    </div>
  );
}
