import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileSignature, Download, Eye, Calendar, User, ShieldCheck, ShieldOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { exportNDAAsPDF } from '@/lib/ndaPdfExport';
import ClientSignNDADialog from '@/components/client/ClientSignNDADialog';
import ClientNDAUpload from '@/components/client/ClientNDAUpload';
import { PenTool } from 'lucide-react';

interface NDAContract {
  id: string;
  consultant_name: string;
  signature_type: string;
  signature_data: string;
  signed_at: string;
  nda_content: string;
  client_signature_data: string | null;
  client_signature_type: string | null;
  client_signer_name: string | null;
  client_signed_at: string | null;
  revoked_at: string | null;
}

export default function ContractsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [contracts, setContracts] = useState<NDAContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewContract, setViewContract] = useState<NDAContract | null>(null);
  const [revokeContract, setRevokeContract] = useState<NDAContract | null>(null);
  const [signContract, setSignContract] = useState<NDAContract | null>(null);
  const [signerDefault, setSignerDefault] = useState('');
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setSignerDefault((u?.user_metadata?.display_name as string) || (u?.user_metadata?.full_name as string) || '');
    });
  }, []);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Get NDAs where the user is the client
    const { data, error } = await supabase
      .from('nda_agreements')
      .select('id, consultant_id, signature_type, signature_data, signed_at, nda_content, revoked_at, client_signature_data, client_signature_type, client_signer_name, client_signed_at')
      .eq('client_id', user.id)
      .order('signed_at', { ascending: false });

    if (error || !data) { setLoading(false); return; }

    // Get consultant names
    const consultantIds = [...new Set(data.map(n => n.consultant_id))];
    const { data: consultants } = await supabase
      .from('consultants')
      .select('id, user_id')
      .in('id', consultantIds);

    const userIds = (consultants || []).map(c => c.user_id);
    const { data: profiles } = await supabase
      .from('profile_directory')
      .select('user_id, display_name')
      .in('user_id', userIds);

    const profileMap = new Map((profiles || []).map(p => [p.user_id, p.display_name || 'Unknown']));
    const consultantUserMap = new Map((consultants || []).map(c => [c.id, c.user_id]));

    setContracts(data.map(n => ({
      id: n.id,
      consultant_name: profileMap.get(consultantUserMap.get(n.consultant_id) || '') || 'Unknown',
      signature_type: n.signature_type,
      signature_data: n.signature_data,
      signed_at: n.signed_at,
      nda_content: n.nda_content,
      revoked_at: n.revoked_at,
      client_signature_data: n.client_signature_data,
      client_signature_type: n.client_signature_type,
      client_signer_name: n.client_signer_name,
      client_signed_at: n.client_signed_at,
    })));
    setLoading(false);
  };

  const revokeNda = async () => {
    if (!revokeContract) return;
    setRevoking(true);
    const { data, error } = await supabase
      .from('nda_agreements')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', revokeContract.id)
      .select('id');
    setRevoking(false);
    if (error || !data || data.length === 0) {
      toast({ title: 'Error', description: error?.message || 'The NDA could not be revoked', variant: 'destructive' });
      return;
    }
    toast({ title: 'NDA revoked', description: 'The consultant has been told. They need to sign a new NDA to continue working with you.' });
    setRevokeContract(null);
    fetchContracts();
  };

  const downloadPDF = async (contract: NDAContract) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      let clientName = '';
      if (user) {
        const { data: cp } = await supabase.from('client_profiles').select('company_name').eq('user_id', user.id).maybeSingle();
        clientName = cp?.company_name || user.user_metadata?.display_name || user.email || '';
      }
      await exportNDAAsPDF({
        ndaContent: contract.nda_content,
        signatureData: contract.signature_data,
        signatureType: contract.signature_type,
        signedAt: contract.signed_at,
        consultantName: contract.consultant_name,
        clientName,
        agreementId: contract.id,
        revokedAt: contract.revoked_at,
        clientSignatureData: contract.client_signature_data,
        clientSignatureType: contract.client_signature_type,
        clientSignerName: contract.client_signer_name,
        clientSignedAt: contract.client_signed_at,
      });
      toast({ title: 'Downloaded', description: 'NDA PDF downloaded successfully' });
    } catch {
      toast({ title: 'Error', description: 'Failed to generate PDF', variant: 'destructive' });
    }
  };

  const activeCount = contracts.filter(c => !c.revoked_at).length;
  const revokedCount = contracts.filter(c => !!c.revoked_at).length;

  const stats = [
    { label: 'Total NDAs', value: String(contracts.length), color: 'text-primary' },
    { label: 'Active', value: String(activeCount), color: 'text-emerald-500' },
    { label: 'Revoked', value: String(revokedCount), color: 'text-destructive' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSignature className="w-6 h-6 text-primary" />
          {t('sidebar.contracts', 'NDA Agreements')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">View and download your signed Non-Disclosure Agreements with consultants</p>
      </div>

      <ClientNDAUpload />

      <div className="grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <Card key={s.label} className="rounded-2xl border-border/50">
            <CardContent className="pt-5 pb-4 text-center">
              <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-4">
        {loading ? (
          [1, 2, 3].map(i => (
            <Card key={i} className="rounded-2xl">
              <CardContent className="p-5">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-12 h-12 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : contracts.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileSignature className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No signed agreements found yet.</p>
            </CardContent>
          </Card>
        ) : (
          contracts.map((contract) => (
            <Card key={contract.id} className="rounded-2xl border-border/50 hover:shadow-premium transition-all">
              <CardContent className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <FileSignature className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-foreground">Non-Disclosure Agreement</h3>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {contract.consultant_name}</span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(contract.signed_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>
                      {contract.revoked_at ? (
                        <Badge variant="destructive" className="shrink-0 text-[10px] gap-1">
                          <ShieldOff className="w-3 h-3" /> Revoked
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="shrink-0 text-[10px] gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <ShieldCheck className="w-3 h-3" /> Active
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant="secondary" className="text-[10px]">NDA</Badge>
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {contract.signature_type === 'draw' ? 'Drawn signature' : 'Typed signature'}
                      </span>
                      <Badge variant={contract.client_signed_at ? 'secondary' : 'outline'} className="text-[10px]">
                        {contract.client_signed_at ? 'Signed by both' : 'Awaiting your signature'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => setViewContract(contract)}>
                      <Eye className="w-3.5 h-3.5" /> View
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => downloadPDF(contract)}>
                      <Download className="w-3.5 h-3.5" /> PDF
                    </Button>
                    {!contract.revoked_at && !contract.client_signed_at && (
                      <Button size="sm" className="gap-1 text-xs" onClick={() => setSignContract(contract)}>
                        <PenTool className="w-3.5 h-3.5" /> Sign
                      </Button>
                    )}
                    {!contract.revoked_at && (
                      <Button variant="outline" size="sm" className="gap-1 text-xs text-destructive" onClick={() => setRevokeContract(contract)}>
                        <ShieldOff className="w-3.5 h-3.5" /> Revoke
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* View NDA Dialog */}
      <Dialog open={!!viewContract} onOpenChange={() => setViewContract(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="w-5 h-5 text-primary" />
              Signed NDA Details
            </DialogTitle>
          </DialogHeader>
          {viewContract && (
            <div className="space-y-4 flex-1 overflow-hidden">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Consultant:</span>
                  <span className="ms-1 font-medium">{viewContract.consultant_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Date Signed:</span>
                  <span className="ms-1">{new Date(viewContract.signed_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <span className="ms-1">{viewContract.revoked_at ? 'Revoked' : 'Active'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Signature Type:</span>
                  <span className="ms-1 capitalize">{viewContract.signature_type}</span>
                </div>
              </div>

              <ScrollArea className="max-h-[200px] border rounded-lg p-4 bg-muted/30">
                <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">
                  {viewContract.nda_content}
                </pre>
              </ScrollArea>

              <div className="border rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">Signature</p>
                {viewContract.signature_type === 'draw' ? (
                  <img src={viewContract.signature_data} alt="Signature" className="max-h-24 border rounded" />
                ) : (
                  <p className="text-xl font-serif italic text-foreground">{viewContract.signature_data}</p>
                )}
              </div>

              <div className="border rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">Client signature</p>
                {!viewContract.client_signed_at ? (
                  <p className="text-sm text-muted-foreground">Not signed yet.</p>
                ) : viewContract.client_signature_type === 'draw' ? (
                  <img src={viewContract.client_signature_data || ''} alt="Client signature" className="max-h-24 border rounded" />
                ) : (
                  <p className="text-xl font-serif italic text-foreground">{viewContract.client_signature_data}</p>
                )}
                {viewContract.client_signer_name && <p className="text-xs text-muted-foreground mt-1">{viewContract.client_signer_name} · {new Date(viewContract.client_signed_at!).toLocaleString()}</p>}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" className="gap-2" onClick={() => downloadPDF(viewContract)}>
                  <Download className="w-4 h-4" /> Download PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {signContract && (
        <ClientSignNDADialog
          open={!!signContract}
          onOpenChange={(o) => { if (!o) setSignContract(null); }}
          ndaId={signContract.id}
          ndaContent={signContract.nda_content}
          consultantName={signContract.consultant_name}
          defaultName={signerDefault}
          onSigned={fetchContracts}
        />
      )}

      {/* Revoke NDA confirmation */}
      <Dialog open={!!revokeContract} onOpenChange={(open) => { if (!open && !revoking) setRevokeContract(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldOff className="w-5 h-5 text-destructive" />
              Revoke this NDA?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The Non-Disclosure Agreement with {revokeContract?.consultant_name} will be marked as revoked and the consultant will be told.
            They have to sign a new NDA before they can see your system details again. This does not remove them from your tickets; remove them from the ticket if you want that.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" disabled={revoking} onClick={() => setRevokeContract(null)}>Cancel</Button>
            <Button variant="destructive" size="sm" className="gap-1" disabled={revoking} onClick={revokeNda}>
              <ShieldOff className="w-3.5 h-3.5" /> {revoking ? 'Revoking…' : 'Revoke NDA'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
