import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShieldCheck, ShieldX, Download, FileSignature } from 'lucide-react';
import { format } from 'date-fns';
import { exportNDAAsPDF } from '@/lib/ndaPdfExport';

interface TicketNDAStatusProps {
  consultantId: string;
  clientId: string;
  consultantName?: string;
  clientName?: string;
}

export default function TicketNDAStatus({ consultantId, clientId, consultantName, clientName }: TicketNDAStatusProps) {
  const { data: nda, isLoading } = useQuery({
    queryKey: ['ticket-nda-status', consultantId, clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from('nda_agreements')
        .select('id, signed_at, signature_data, signature_type, nda_content, revoked_at')
        .eq('consultant_id', consultantId)
        .eq('client_id', clientId)
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!consultantId && !!clientId,
  });

  if (isLoading) return null;

  const isSigned = !!nda && !nda.revoked_at;
  const isRevoked = !!nda?.revoked_at;

  const handleExport = async () => {
    if (!nda) return;
    await exportNDAAsPDF({
      ndaContent: nda.nda_content || '',
      signatureData: nda.signature_data || '',
      signatureType: nda.signature_type || 'type',
      signedAt: nda.signed_at,
      consultantName,
      clientName,
    });
  };

  return (
    <Card className={`rounded-2xl border-border/50 ${isSigned ? 'border-green-500/30' : isRevoked ? 'border-destructive/30' : 'border-amber-500/30'}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <FileSignature className="w-4 h-4 text-primary" />
          Non-Disclosure Agreement
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isSigned ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-700">NDA Signed</p>
                <p className="text-xs text-muted-foreground">
                  Signed on {format(new Date(nda.signed_at), 'MMM d, yyyy')} by {consultantName || 'Consultant'}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExport}>
              <Download className="w-3.5 h-3.5" />
              Export PDF
            </Button>
          </div>
        ) : isRevoked ? (
          <div className="flex items-center gap-2">
            <ShieldX className="w-5 h-5 text-destructive" />
            <div>
              <p className="text-sm font-medium text-destructive">NDA Revoked</p>
              <p className="text-xs text-muted-foreground">
                Revoked on {format(new Date(nda!.revoked_at!), 'MMM d, yyyy')}. Consultant must re-sign.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ShieldX className="w-5 h-5 text-amber-500" />
            <div>
              <p className="text-sm font-medium text-amber-700">NDA Not Yet Signed</p>
              <p className="text-xs text-muted-foreground">
                The assigned consultant has not signed the NDA yet.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
