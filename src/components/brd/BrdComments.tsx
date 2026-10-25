import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MessageSquare, CheckCircle2, Lightbulb, Reply } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { addBrdComment, setBrdCommentStatus, type BrdCommentRow } from '@/lib/brd/api';
import { contactDetailsInText } from '../../../supabase/functions/_shared/assignmentInfo';

interface Props {
  ticketId: string;
  version: number;
  section: string;
  comments: BrdCommentRow[];
  /** Consultants / company members may suggest changes; the client and admins decide. */
  canSuggest: boolean;
  canDecide: boolean;
  onChanged: () => void;
  onAcceptSuggestion?: (c: BrdCommentRow) => void;
  dir: 'ltr' | 'rtl';
}

/** Threaded comments for one section of one version. Contact details are refused (same rule as the rest of the portal). */
export default function BrdComments({ ticketId, version, section, comments, canSuggest, canDecide, onChanged, onAcceptSuggestion, dir }: Props) {
  const { t } = useTranslation();
  const mine = comments.filter((c) => c.section_key === section && c.version === version);
  const roots = mine.filter((c) => !c.parent_id);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [suggest, setSuggest] = useState('');
  const [mode, setMode] = useState<'comment' | 'suggestion'>('comment');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = contactDetailsInText(text) || contactDetailsInText(suggest);

  const send = async () => {
    setBusy(true);
    const r = await addBrdComment(ticketId, version, section, text.trim(), replyTo, mode, mode === 'suggestion' ? suggest.trim() : null);
    setBusy(false);
    if (r.error) { toast.error(r.error.message); return; }
    setText(''); setSuggest(''); setReplyTo(null); setOpen(false); setMode('comment');
    onChanged();
  };

  return (
    <div className="rounded-xl bg-muted/40 p-2 space-y-2">
      {roots.map((c) => (
        <div key={c.id} className="space-y-1">
          <Item c={c} canDecide={canDecide} onReply={() => { setReplyTo(c.id); setOpen(true); setMode('comment'); }} onAccept={onAcceptSuggestion} onChanged={onChanged} dir={dir} />
          {mine.filter((x) => x.parent_id === c.id).map((r) => <div key={r.id} className="ms-6"><Item c={r} canDecide={canDecide} onChanged={onChanged} dir={dir} /></div>)}
        </div>
      ))}
      {!open ? (
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setOpen(true); setMode('comment'); setReplyTo(null); }}>
            <MessageSquare className="h-3.5 w-3.5" /> {roots.length ? t('brd.comments.add') : t('brd.comments.first')}
          </Button>
          {canSuggest && (
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => { setOpen(true); setMode('suggestion'); setReplyTo(null); }}>
              <Lightbulb className="h-3.5 w-3.5" /> {t('brd.comments.suggest')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {replyTo && <p className="text-[11px] text-muted-foreground">{t('brd.comments.replying')}</p>}
          <Textarea dir={dir} rows={2} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)}
            aria-label={mode === 'suggestion' ? t('brd.comments.why') : t('brd.comments.label')}
            placeholder={mode === 'suggestion' ? t('brd.comments.why') : t('brd.comments.label')} />
          {mode === 'suggestion' && (
            <Textarea dir={dir} rows={4} value={suggest} maxLength={20000} onChange={(e) => setSuggest(e.target.value)}
              aria-label={t('brd.comments.suggested')} placeholder={t('brd.comments.suggested')} />
          )}
          {blocked && <p className="text-xs text-destructive" role="alert">{t('brd.comments.noContacts')}</p>}
          <div className="flex gap-1.5 justify-end">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setOpen(false); setReplyTo(null); }}>{t('common.cancel', 'Cancel')}</Button>
            <Button size="sm" className="h-7 text-xs" busy={busy} disabled={!text.trim() || blocked || (mode === 'suggestion' && !suggest.trim())} onClick={send}>{t('brd.comments.send')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Item({ c, canDecide, onReply, onAccept, onChanged, dir }: {
  c: BrdCommentRow; canDecide: boolean; onReply?: () => void; onAccept?: (c: BrdCommentRow) => void; onChanged: () => void; dir: 'ltr' | 'rtl';
}) {
  const { t, i18n } = useTranslation();
  const status = async (s: BrdCommentRow['status']) => {
    const r = await setBrdCommentStatus(c.id, s);
    if (r.error) toast.error(r.error.message); else onChanged();
  };
  return (
    <div className="rounded-lg bg-background border border-border p-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{c.author}</span>
        <Badge variant="outline" className="text-[10px]">{t(`brd.role.${c.author_role}`)}</Badge>
        {c.kind === 'suggestion' && <Badge variant="secondary" className="text-[10px]">{t('brd.comments.suggestion')}</Badge>}
        {c.status !== 'open' && <Badge variant="secondary" className="text-[10px]">{t(`brd.comments.st_${c.status}`)}</Badge>}
        <span>{new Date(c.created_at).toLocaleString(i18n.language?.startsWith('ar') ? 'ar' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
      </div>
      <p dir={dir} className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
      {c.suggested_text && <blockquote dir={dir} className="mt-1 border-s-2 border-accent ps-2 text-sm whitespace-pre-wrap break-words">{c.suggested_text}</blockquote>}
      <div className="flex flex-wrap gap-1 mt-1">
        {onReply && <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={onReply}><Reply className="h-3 w-3" /> {t('brd.comments.reply')}</Button>}
        {canDecide && c.status === 'open' && c.kind === 'suggestion' && onAccept && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1" onClick={() => onAccept(c)}><CheckCircle2 className="h-3 w-3" /> {t('brd.comments.accept')}</Button>
        )}
        {canDecide && c.status === 'open' && c.kind === 'suggestion' && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => status('declined')}>{t('brd.comments.decline')}</Button>
        )}
        {canDecide && c.status === 'open' && c.kind === 'comment' && !c.parent_id && (
          <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => status('resolved')}>{t('brd.comments.resolve')}</Button>
        )}
      </div>
    </div>
  );
}
