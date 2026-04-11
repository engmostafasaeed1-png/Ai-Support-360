import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Network } from 'lucide-react';

export default function ConsultantBusinessProcessesPage() {
  const { data: processes = [], isLoading } = useQuery({
    queryKey: ['consultant-business-processes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_processes')
        .select('*')
        .eq('consultant_visible', true)
        .order('category', { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Network className="w-6 h-6 text-primary" />
          Client Business Processes
        </h1>
        <p className="text-sm text-muted-foreground mt-1">View approved business processes from your clients.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : processes.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-12 text-center">
            <Network className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No business processes shared with you yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {processes.map((proc: any) => (
            <Card key={proc.id} className="rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-foreground">{proc.name}</h3>
                  <Badge variant="secondary" className="text-[10px]">{proc.category}</Badge>
                  {proc.sap_module && <Badge variant="outline" className="text-[10px]">{proc.sap_module}</Badge>}
                </div>
                {proc.description && <p className="text-sm text-muted-foreground mt-1">{proc.description}</p>}
                {proc.process_owner && <p className="text-xs text-muted-foreground mt-1">Owner: {proc.process_owner}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
