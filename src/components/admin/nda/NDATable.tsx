import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Eye, Download, Calendar, ShieldOff, ShieldCheck } from 'lucide-react';
import type { NDARecord } from './types';

interface NDATableProps {
  ndas: NDARecord[];
  loading: boolean;
  onView: (nda: NDARecord) => void;
  onDownload: (nda: NDARecord) => void;
  onRevoke: (nda: NDARecord) => void;
}

export default function NDATable({ ndas, loading, onView, onDownload, onRevoke }: NDATableProps) {
  const { t } = useTranslation();

  return (
    <Card className="rounded-2xl overflow-hidden">
      <div className="overflow-x-auto">
      <Table className="min-w-[600px]">
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.nda_consultant', 'Consultant')}</TableHead>
            <TableHead>{t('admin.nda_client', 'Client')}</TableHead>
            <TableHead>{t('admin.nda_status', 'Status')}</TableHead>
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
          ) : ndas.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                {t('admin.nda_empty', 'No signed NDAs found.')}
              </TableCell>
            </TableRow>
          ) : (
            ndas.map((nda) => (
              <TableRow key={nda.id}>
                <TableCell className="font-medium">{nda.consultant_name}</TableCell>
                <TableCell>{nda.client_name}</TableCell>
                <TableCell>
                  {nda.revoked_at ? (
                    <Badge variant="destructive" className="text-[10px] gap-1">
                      <ShieldOff className="w-3 h-3" />
                      {t('admin.nda_revoked', 'Revoked')}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] gap-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      <ShieldCheck className="w-3 h-3" />
                      {t('admin.nda_active_badge', 'Active')}
                    </Badge>
                  )}
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
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onView(nda)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onDownload(nda)}>
                      <Download className="w-4 h-4" />
                    </Button>
                    {!nda.revoked_at && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onRevoke(nda)}>
                        <ShieldOff className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>
    </Card>
  );
}
