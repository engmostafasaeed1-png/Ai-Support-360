import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useTicketDocuments } from '@/hooks/useTicketDocuments';
import { INCLUDE_KEYS, type IncludeFlags } from '../../../supabase/functions/_shared/brdTicketParts';

const TEXT_TYPES = /\.(pdf|docx|txt|md|csv)$/i;

interface Props {
  ticketId: string;
  include: IncludeFlags;
  onInclude: (f: IncludeFlags) => void;
  files: string[];
  onFiles: (ids: string[]) => void;
  maxFiles: number;
}

/** The client ticks which parts of the ticket the AI may read, and up to N of their own files (text only). */
export default function IncludePicker({ ticketId, include, onInclude, files, onFiles, maxFiles }: Props) {
  const { t } = useTranslation();
  const { data: docs = [] } = useTicketDocuments(ticketId);
  const usable = docs.filter((d) => TEXT_TYPES.test(d.file_name) && (d as { doc_type?: string }).doc_type !== 'brd');
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold">{t('brd.wizard.includeHeading')}</legend>
      <div className="grid sm:grid-cols-2 gap-2">
        {INCLUDE_KEYS.filter((k) => k !== 'attachments').map((k) => (
          <div key={k} className="flex items-center gap-2">
            <Checkbox id={`brd-inc-${k}`} checked={include[k] !== false} onCheckedChange={(v) => onInclude({ ...include, [k]: v === true })} />
            <Label htmlFor={`brd-inc-${k}`} className="text-sm font-normal">{t(`brd.wizard.inc_${k}`)}</Label>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t('brd.wizard.files', { max: maxFiles })}</p>
        {usable.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('brd.wizard.noFiles')}</p>
        ) : usable.map((d) => {
          const on = files.includes(d.id);
          return (
            <div key={d.id} className="flex items-center gap-2">
              <Checkbox id={`brd-file-${d.id}`} checked={on} disabled={!on && files.length >= maxFiles}
                onCheckedChange={(v) => onFiles(v === true ? [...files, d.id] : files.filter((x) => x !== d.id))} />
              <Label htmlFor={`brd-file-${d.id}`} className="text-sm font-normal break-all">{d.file_name}</Label>
            </div>
          );
        })}
        <p className="text-[11px] text-muted-foreground">{t('brd.wizard.filesNote')}</p>
      </div>
    </fieldset>
  );
}
