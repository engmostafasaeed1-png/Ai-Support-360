import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Brain, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  sessionId: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'icon';
}

export default function AnalyzeSessionButton({ sessionId, variant = 'outline', size = 'sm' }: Props) {
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-session-analysis', {
        body: { session_id: sessionId },
      });
      if (error) throw error;
      if (data?.error) {
        if (data.error === 'Rate limited') toast.error('AI is busy, please try again in a moment.');
        else if (data.error === 'Credits exhausted') toast.error('AI credits exhausted. Please add funds in Settings.');
        else throw new Error(data.error);
        return;
      }
      toast.success('Session analysis complete! Check your feedback & survey.');
    } catch (e) {
      toast.error('Failed to analyze session');
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant={variant} size={size} onClick={analyze} disabled={loading} className="gap-1.5">
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
      {loading ? 'Analyzing...' : 'AI Analysis'}
    </Button>
  );
}
