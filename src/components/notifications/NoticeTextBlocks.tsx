import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { noticeBlocks } from '@/lib/noticeText';

/** Stored notice text as short paragraphs and bullet lists (plain text only, React escapes it). */
export default function NoticeTextBlocks({ text, firstName, dropLinks = true, className }: {
  text: string | null | undefined; firstName?: string | null; dropLinks?: boolean; className?: string;
}) {
  const blocks = useMemo(() => noticeBlocks(text, { firstName, dropLinks }), [text, firstName, dropLinks]);
  if (!blocks.length) return null;
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-muted-foreground', className)} dir="auto">
      {blocks.map((b, i) => (b.type === 'p'
        ? <p key={i}>{b.text}</p>
        : <ul key={i} className="list-disc space-y-1 ps-5">{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>))}
    </div>
  );
}
