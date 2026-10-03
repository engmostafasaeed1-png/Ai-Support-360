import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sapNoteLink } from '@/lib/aiSuggest';
import { MAX_NOTES_TRIED, addNoteNumbers } from '@/lib/sapNotes';

/** SAP Note numbers as links. A note opens in SAP for Me, where every person signs in with their own SAP login. */
export function SapNoteLinks({ notes, onRemove }: { notes: readonly string[]; onRemove?: (note: string) => void }) {
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="sap-note-links">
      {notes.map(n => (
        <Badge key={n} variant="secondary" className="gap-1.5 font-mono text-[11px]">
          <a href={sapNoteLink(n)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
            <span>{n}</span>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">(opens SAP for Me in a new tab)</span>
          </a>
          {onRemove && (
            <button type="button" aria-label={`Remove SAP Note ${n}`} onClick={() => onRemove(n)} className="text-muted-foreground hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      ))}
    </div>
  );
}

interface Props {
  value: string[];
  onChange: (notes: string[]) => void;
  idPrefix?: string;
}

/** A client lists the SAP Notes already tried. Only the numbers are kept; no SAP login is asked for. */
export default function SapNotesField({ value, onChange, idPrefix = 'sap-notes-tried' }: Props) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState('');

  const add = () => {
    if (!text.trim()) return;
    const result = addNoteNumbers(value, text);
    if (result.added.length > 0) onChange(result.notes);
    setText(result.ignored.join(' '));
    if (result.full) setHint(`You can list ${MAX_NOTES_TRIED} SAP Notes at most.`);
    else if (result.ignored.length > 0) setHint(`SAP Note numbers have 5 to 8 digits. Please check: ${result.ignored.join(', ')}`);
    else setHint('');
  };

  return (
    <div>
      <label htmlFor={`${idPrefix}-input`} className="mb-1.5 block text-sm font-medium">SAP Notes you already tried (optional)</label>
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-input`}
          value={text}
          onChange={e => { setText(e.target.value); setHint(''); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder="For example 2270407, 3012345"
          className="rounded-xl"
          maxLength={120}
        />
        <Button type="button" variant="outline" size="sm" className="h-10" disabled={!text.trim() || value.length >= MAX_NOTES_TRIED} onClick={add}>Add</Button>
      </div>
      {hint && <p className="mt-1 text-[11px] text-destructive" role="alert">{hint}</p>}
      <div className="mt-2">
        <SapNoteLinks notes={value} onRemove={n => onChange(value.filter(x => x !== n))} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Numbers only. Each note opens in SAP for Me, where you sign in with your own SAP login. We never ask for your SAP login, and the AI will not suggest these notes again.
      </p>
    </div>
  );
}
