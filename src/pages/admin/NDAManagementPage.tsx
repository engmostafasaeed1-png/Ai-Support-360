import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FileSignature, Search, Download, Eye, Calendar, ShieldOff, ShieldCheck } from 'lucide-react';

interface NDARecord {
  id: string;
  consultant_name: string;
  client_name: string;
  signature_type: string;
  signature_data: string;
  signed_at: string;
  nda_content: string;
  revoked_at: string | null;
}

export default function NDAManagementPage() {
  const { t } = useTranslation();
  const [ndas, setNdas] = useState<NDARecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewNda, setViewNda] = useState<NDARecord | null>(null);
  const [revokeNda, setRevokeNda] = useState<NDARecord | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    fetchNDAs();
  }, []);

  const fetchNDAs = async () => {
    setLoading(true);
    // Fetch NDA agreements with consultant and client names
    const { data, error } = await supabase
      .from('nda_agreements')
      .select('id, consultant_id, client_id, signature_type, signature_data, signed_at, nda_content, revoked_at')
      .order('signed_at', { ascending: false });

    if (error || !data) {
      setLoading(false);
      return;
    }

    // Get consultant and client names
    const consultantIds = [...new Set(data.map((n: any) => n.consultant_id))];
    const clientIds = [...new Set(data.map((n: any) => n.client_id))];

    // Fetch consultant names via consultants -> profiles
    const { data: consultants } = await supabase
      .from('consultants')
      .select('id, user_id')
      .in('id', consultantIds);

    const consultantUserIds = (consultants || []).map((c: any) => c.user_id);
    const allUserIds = [...new Set([...consultantUserIds, ...clientIds])];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', allUserIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p.display_name || 'Unknown']));
    const consultantUserMap = new Map((consultants || []).map((c: any) => [c.id, c.user_id]));

    const records: NDARecord[] = data.map((n: any) => ({
      id: n.id,
      consultant_name: profileMap.get(consultantUserMap.get(n.consultant_id) || '') || 'Unknown',
      client_name: profileMap.get(n.client_id) || 'Unknown',
      signature_type: n.signature_type,
      signature_data: n.signature_data,
      signed_at: n.signed_at,
      nda_content: n.nda_content,
    }));

    setNdas(records);
    setLoading(false);
  };

  const filtered = ndas.filter((n) =>
    n.consultant_name.toLowerCase().includes(search.toLowerCase()) ||
    n.client_name.toLowerCase().includes(search.toLowerCase())
  );

  const downloadSignature = (nda: NDARecord) => {
    if (nda.signature_type === 'draw') {
      // Download the drawn signature as PNG
      const link = document.createElement('a');
      link.href = nda.signature_data;
      link.download = `nda-signature-${nda.id.slice(0, 8)}.png`;
      link.click();
    } else {
      // Download typed signature as text file
      const blob = new Blob(
        [`Typed Signature: ${nda.signature_data}\nSigned at: ${new Date(nda.signed_at).toLocaleString()}\nConsultant: ${nda.consultant_name}\nClient: ${nda.client_name}`],
        { type: 'text/plain' }
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nda-signature-${nda.id.slice(0, 8)}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FileSignature className="w-6 h-6 text-primary" />
          {t('admin.nda_management_title', 'NDA Management')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('admin.nda_management_subtitle', 'View all signed Non-Disclosure Agreements between consultants and clients.')}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{ndas.length}</p>
            <p className="text-xs text-muted-foreground">{t('admin.nda_total', 'Total NDAs Signed')}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {ndas.filter(n => n.signature_type === 'draw').length}
            </p>
            <p className="text-xs text-muted-foreground">{t('admin.nda_drawn', 'Drawn Signatures')}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {ndas.filter(n => n.signature_type === 'type').length}
            </p>
            <p className="text-xs text-muted-foreground">{t('admin.nda_typed', 'Typed Signatures')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('admin.nda_search', 'Search by consultant or client name...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ps-9 rounded-xl"
        />
      </div>

      {/* Table */}
      <Card className="rounded-2xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.nda_consultant', 'Consultant')}</TableHead>
              <TableHead>{t('admin.nda_client', 'Client')}</TableHead>
              <TableHead>{t('admin.nda_sig_type', 'Signature Type')}</TableHead>
              <TableHead>{t('admin.nda_date', 'Date Signed')}</TableHead>
              <TableHead className="text-end">{t('admin.nda_actions', 'Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              [1, 2, 3].map(i => (
                <TableRow key={i}>
                  {[1, 2, 3, 4, 5].map(j => (
                    <TableCell key={j}><Skeleton className="h-4 w-24" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  {t('admin.nda_empty', 'No signed NDAs found.')}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((nda) => (
                <TableRow key={nda.id}>
                  <TableCell className="font-medium">{nda.consultant_name}</TableCell>
                  <TableCell>{nda.client_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {nda.signature_type === 'draw' ? '✍️ ' + t('nda.draw_signature', 'Draw') : '⌨️ ' + t('nda.type_signature', 'Type')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5" />
                      {new Date(nda.signed_at).toLocaleDateString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setViewNda(nda)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => downloadSignature(nda)}>
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* View NDA Dialog */}
      <Dialog open={!!viewNda} onOpenChange={() => setViewNda(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSignature className="w-5 h-5 text-primary" />
              {t('admin.nda_view_title', 'Signed NDA Details')}
            </DialogTitle>
          </DialogHeader>
          {viewNda && (
            <div className="space-y-4 flex-1 overflow-hidden">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">{t('admin.nda_consultant', 'Consultant')}:</span>
                  <span className="ms-1 font-medium">{viewNda.consultant_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('admin.nda_client', 'Client')}:</span>
                  <span className="ms-1 font-medium">{viewNda.client_name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('admin.nda_date', 'Date Signed')}:</span>
                  <span className="ms-1">{new Date(viewNda.signed_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">{t('admin.nda_sig_type', 'Signature Type')}:</span>
                  <span className="ms-1">{viewNda.signature_type === 'draw' ? t('nda.draw_signature') : t('nda.type_signature')}</span>
                </div>
              </div>

              {/* NDA Content */}
              <ScrollArea className="max-h-[200px] border rounded-lg p-4 bg-muted/30">
                <pre className="whitespace-pre-wrap text-sm font-sans text-foreground leading-relaxed">
                  {viewNda.nda_content}
                </pre>
              </ScrollArea>

              {/* Signature */}
              <div className="border rounded-lg p-4">
                <p className="text-xs text-muted-foreground mb-2">{t('admin.nda_signature', 'Signature')}</p>
                {viewNda.signature_type === 'draw' ? (
                  <img src={viewNda.signature_data} alt="Signature" className="max-h-24 border rounded" />
                ) : (
                  <p className="text-xl font-serif italic text-foreground">{viewNda.signature_data}</p>
                )}
              </div>

              <div className="flex justify-end">
                <Button variant="outline" className="gap-2" onClick={() => downloadSignature(viewNda)}>
                  <Download className="w-4 h-4" />
                  {t('admin.nda_download', 'Download Signature')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
