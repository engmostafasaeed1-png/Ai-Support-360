import { useTranslation } from 'react-i18next';
import type { BrdAccessRow } from '@/lib/brd/api';

/** Who opened or downloaded which attached version (consultants and company colleagues). */
export default function BrdAccessLog({ rows }: { rows: BrdAccessRow[] }) {
  const { t, i18n } = useTranslation();
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t('brd.access.none')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="brd-table">
        <caption className="sr-only">{t('brd.access.caption')}</caption>
        <thead><tr><th>{t('brd.access.who')}</th><th>{t('brd.access.role')}</th><th>{t('brd.versions.version')}</th><th>{t('brd.access.action')}</th><th>{t('brd.access.when')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.viewer}</td><td>{t(`brd.role.${r.role}`)}</td><td>v{r.version}</td><td>{t(`brd.access.${r.action}`)}</td>
              <td>{new Date(r.at).toLocaleString(i18n.language?.startsWith('ar') ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
