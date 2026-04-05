import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileSignature, Search, FileDown } from 'lucide-react';
import type { NDARecord } from '@/components/admin/nda/types';
import NDAStatsCards from '@/components/admin/nda/NDAStatsCards';
import NDATable from '@/components/admin/nda/NDATable';
import NDAViewDialog from '@/components/admin/nda/NDAViewDialog';
import NDARevokeDialog from '@/components/admin/nda/NDARevokeDialog';

export default function NDAManagementPage() {
  const { t } = useTranslation();
  const [ndas, setNdas] = useState<NDARecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewNda, setViewNda] = useState<NDARecord | null>(null);
  const [revokeNda, setRevokeNda] = useState<NDARecord | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => { fetchNDAs(); }, []);

  const fetchNDAs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('nda_agreements')
      .select('id, consultant_id, client_id, signature_type, signature_data, signed_at, nda_content, revoked_at')
      .order('signed_at', { ascending: false });

    if (error || !data) { setLoading(false); return; }

    const consultantIds = [...new Set(data.map((n) => n.consultant_id))];
    const clientIds = [...new Set(data.map((n) => n.client_id))];

    const { data: consultants } = await supabase
      .from('consultants')
      .select('id, user_id')
      .in('id', consultantIds);

    const consultantUserIds = (consultants || []).map((c) => c.user_id);
    const allUserIds = [...new Set([...consultantUserIds, ...clientIds])];

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, display_name')
      .in('user_id', allUserIds);

    const profileMap = new Map((profiles || []).map((p) => [p.user_id, p.display_name || 'Unknown']));
    const consultantUserMap = new Map((consultants || []).map((c) => [c.id, c.user_id]));

    setNdas(data.map((n) => ({
      id: n.id,
      consultant_name: profileMap.get(consultantUserMap.get(n.consultant_id) || '') || 'Unknown',
      client_name: profileMap.get(n.client_id) || 'Unknown',
      signature_type: n.signature_type,
      signature_data: n.signature_data,
      signed_at: n.signed_at,
      nda_content: n.nda_content,
      revoked_at: n.revoked_at,
    })));
    setLoading(false);
  };

  const filtered = ndas.filter((n) =>
    n.consultant_name.toLowerCase().includes(search.toLowerCase()) ||
    n.client_name.toLowerCase().includes(search.toLowerCase())
  );

  const downloadSignature = (nda: NDARecord) => {
    if (nda.signature_type === 'draw') {
      const link = document.createElement('a');
      link.href = nda.signature_data;
      link.download = `nda-signature-${nda.id.slice(0, 8)}.png`;
      link.click();
    } else {
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

  const handleRevoke = async () => {
    if (!revokeNda) return;
    setRevoking(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('nda_agreements')
      .update({ revoked_at: new Date().toISOString(), revoked_by: user?.id })
      .eq('id', revokeNda.id);
    setRevoking(false);
    setRevokeNda(null);
    if (!error) {
      setNdas(prev => prev.map(n => n.id === revokeNda.id ? { ...n, revoked_at: new Date().toISOString() } : n));
    }
  };

  const exportCSV = () => {
    const headers = ['Consultant', 'Client', 'Signature Type', 'Date Signed', 'Status'];
    const rows = ndas.map(n => [
      n.consultant_name, n.client_name, n.signature_type,
      new Date(n.signed_at).toISOString(), n.revoked_at ? 'Revoked' : 'Active',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nda-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileSignature className="w-6 h-6 text-primary" />
            {t('admin.nda_management_title', 'NDA Management')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('admin.nda_management_subtitle', 'View all signed Non-Disclosure Agreements between consultants and clients.')}
          </p>
        </div>
        <Button variant="outline" className="gap-2" onClick={exportCSV} disabled={ndas.length === 0}>
          <FileDown className="w-4 h-4" />
          {t('admin.nda_export_csv', 'Export CSV')}
        </Button>
      </div>

      <NDAStatsCards
        total={ndas.length}
        drawn={ndas.filter(n => n.signature_type === 'draw').length}
        active={ndas.filter(n => !n.revoked_at).length}
        revoked={ndas.filter(n => !!n.revoked_at).length}
      />

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('admin.nda_search', 'Search by consultant or client name...')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ps-9 rounded-xl"
        />
      </div>

      <NDATable
        ndas={filtered}
        loading={loading}
        onView={setViewNda}
        onDownload={downloadSignature}
        onRevoke={setRevokeNda}
      />

      <NDAViewDialog nda={viewNda} onClose={() => setViewNda(null)} onDownload={downloadSignature} />
      <NDARevokeDialog nda={revokeNda} revoking={revoking} onClose={() => setRevokeNda(null)} onConfirm={handleRevoke} />
    </div>
  );
}
