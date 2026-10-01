import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { MessageSquareText, Pin, Loader2, Plus, Trash2, Send } from 'lucide-react';

interface Props {
  ticketId: string;
}

export default function TicketInternalNotes({ ticketId }: Props) {
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: notes = [], isLoading } = useQuery({
    queryKey: ['ticket-internal-notes', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_internal_notes')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const authorIds = [...new Set((data || []).map((n: any) => n.author_id))];
      const { data: profiles } = await supabase
        .from('profile_directory')
        .select('user_id, display_name')
        .in('user_id', authorIds);
      const nameMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p.display_name || 'Unknown']));

      return (data || []).map((n: any) => ({
        ...n,
        author_name: nameMap[n.author_id] || 'Unknown',
      }));
    },
  });

  const handleAdd = async () => {
    if (!newNote.trim()) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('ticket_internal_notes').insert({
        ticket_id: ticketId,
        author_id: user.id,
        content: newNote.trim(),
      } as any);
      if (error) throw error;
      toast.success('Internal note added');
      setNewNote('');
      queryClient.invalidateQueries({ queryKey: ['ticket-internal-notes', ticketId] });
    } catch {
      toast.error('Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  const handlePin = async (noteId: string, isPinned: boolean) => {
    const { error } = await supabase
      .from('ticket_internal_notes')
      .update({ is_pinned: !isPinned } as any)
      .eq('id', noteId);
    if (error) { toast.error('Failed'); return; }
    queryClient.invalidateQueries({ queryKey: ['ticket-internal-notes', ticketId] });
  };

  const handleDelete = async (noteId: string) => {
    const { error } = await supabase.from('ticket_internal_notes').delete().eq('id', noteId);
    if (error) { toast.error('Failed'); return; }
    toast.success('Note deleted');
    queryClient.invalidateQueries({ queryKey: ['ticket-internal-notes', ticketId] });
  };

  if (isLoading) return <Skeleton className="h-32 rounded-2xl" />;

  const pinned = notes.filter((n: any) => n.is_pinned);
  const regular = notes.filter((n: any) => !n.is_pinned);

  return (
    <div className="space-y-3">
      {/* Add note */}
      <div className="flex gap-2">
        <Textarea
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="Add an internal note (visible to team only)..."
          rows={2}
          className="flex-1 text-sm"
        />
        <Button
          onClick={handleAdd}
          disabled={saving || !newNote.trim()}
          size="sm"
          className="gap-1.5 gradient-primary border-0 self-end h-9"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        </Button>
      </div>

      <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-700 flex items-center gap-1.5">
        <MessageSquareText className="w-3.5 h-3.5 shrink-0" />
        Internal notes are private — only team members can see them, not clients.
      </div>

      {/* Pinned notes */}
      {pinned.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Pin className="w-3 h-3" /> Pinned
          </p>
          {pinned.map((note: any) => (
            <NoteCard key={note.id} note={note} onPin={handlePin} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Regular notes */}
      {regular.map((note: any) => (
        <NoteCard key={note.id} note={note} onPin={handlePin} onDelete={handleDelete} />
      ))}

      {notes.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">No internal notes yet</p>
      )}
    </div>
  );
}

function NoteCard({ note, onPin, onDelete }: { note: any; onPin: (id: string, pinned: boolean) => void; onDelete: (id: string) => void }) {
  return (
    <Card className={`rounded-xl border-border/30 ${note.is_pinned ? 'border-amber-300 bg-amber-50/30' : ''}`}>
      <CardContent className="p-3">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[10px] font-bold text-primary">
            {note.author_name?.charAt(0) || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-semibold text-foreground">{note.author_name}</span>
              <span className="text-[10px] text-muted-foreground">
                {format(new Date(note.created_at), 'MMM d, h:mm a')}
              </span>
              <div className="ms-auto flex items-center gap-1">
                <button onClick={() => onPin(note.id, note.is_pinned)} className="text-muted-foreground hover:text-amber-500 transition-colors">
                  <Pin className={`w-3 h-3 ${note.is_pinned ? 'fill-amber-500 text-amber-500' : ''}`} />
                </button>
                <button onClick={() => onDelete(note.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
