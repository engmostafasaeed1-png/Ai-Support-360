import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface TicketDocument {
  id: string;
  ticket_id: string;
  uploaded_by: string;
  file_name: string;
  file_url: string;
  file_size: number | null;
  mime_type: string | null;
  version: number;
  comment: string | null;
  created_at: string;
  uploader_name?: string;
}

export function useTicketDocuments(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['ticket-documents', ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_documents')
        .select('*')
        .eq('ticket_id', ticketId!)
        .order('file_name')
        .order('version', { ascending: false });
      if (error) throw error;

      // Resolve uploader names
      const uploaderIds = [...new Set((data || []).map(d => d.uploaded_by))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', uploaderIds);
      const nameMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p.display_name || 'Unknown']));

      return (data || []).map(d => ({
        ...d,
        uploader_name: nameMap[d.uploaded_by] || d.uploaded_by,
      })) as TicketDocument[];
    },
  });
}

export function useUploadTicketDocument(ticketId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, comment }: { file: File; comment?: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Get next version number for this file name
      const { data: existing } = await supabase
        .from('ticket_documents')
        .select('version')
        .eq('ticket_id', ticketId)
        .eq('file_name', file.name)
        .order('version', { ascending: false })
        .limit(1);

      const nextVersion = (existing && existing.length > 0) ? (existing[0] as any).version + 1 : 1;

      // Upload to storage: ticket-documents/{ticketId}/{userId}/{timestamp}_{filename}
      const storagePath = `${ticketId}/${session.user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('ticket-documents')
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('ticket-documents').getPublicUrl(storagePath);

      // Insert document record
      const { error: insertError } = await supabase
        .from('ticket_documents')
        .insert({
          ticket_id: ticketId,
          uploaded_by: session.user.id,
          file_name: file.name,
          file_url: storagePath,
          file_size: file.size,
          mime_type: file.type || null,
          version: nextVersion,
          comment: comment || null,
        } as any);
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-documents', ticketId] });
      toast.success('Document uploaded');
    },
    onError: (err: any) => toast.error('Upload failed', { description: err.message }),
  });
}

export function useDeleteTicketDocument(ticketId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (doc: TicketDocument) => {
      // Delete from storage
      await supabase.storage.from('ticket-documents').remove([doc.file_url]);
      // Delete record
      const { error } = await supabase.from('ticket_documents').delete().eq('id', doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-documents', ticketId] });
      toast.success('Document deleted');
    },
    onError: (err: any) => toast.error('Delete failed', { description: err.message }),
  });
}
