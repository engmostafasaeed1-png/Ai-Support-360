import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';

export function useProjectMilestones(projectId: string) {
  const { isGuest } = useGuestMode();
  return useQuery({
    queryKey: ['milestones', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('milestones')
        .select('*')
        .eq('project_id', projectId)
        .order('position', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId && !isGuest,
    placeholderData: isGuest ? mockMilestones as any : undefined,
  });
}

export function useCreateMilestone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { project_id: string; title: string; description?: string; amount: number; due_date?: string; position: number }) => {
      const { error } = await supabase.from('milestones').insert(payload as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['milestones', vars.project_id] });
    },
  });
}

export function useUpdateMilestoneStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, escrow_status, project_id }: { id: string; escrow_status: string; project_id: string }) => {
      const timestamps: Record<string, string> = {};
      if (escrow_status === 'funded') timestamps.funded_at = new Date().toISOString();
      if (escrow_status === 'submitted') timestamps.submitted_at = new Date().toISOString();
      if (escrow_status === 'approved') timestamps.approved_at = new Date().toISOString();
      if (escrow_status === 'released') timestamps.released_at = new Date().toISOString();

      const { error } = await supabase
        .from('milestones')
        .update({ escrow_status: escrow_status as any, ...timestamps } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['milestones', vars.project_id] });
    },
  });
}

const mockMilestones = [
  { id: '1', project_id: 'p1', title: 'Discovery & Requirements', description: 'Initial assessment', amount: 2000, currency: 'USD', position: 0, escrow_status: 'released', due_date: '2026-03-15', funded_at: '2026-03-01', released_at: '2026-03-14' },
  { id: '2', project_id: 'p1', title: 'Configuration & Development', description: 'Core implementation', amount: 5000, currency: 'USD', position: 1, escrow_status: 'in_progress', due_date: '2026-04-15', funded_at: '2026-03-15' },
  { id: '3', project_id: 'p1', title: 'Testing & Go-Live', description: 'UAT and deployment', amount: 3000, currency: 'USD', position: 2, escrow_status: 'unfunded', due_date: '2026-05-01' },
];
