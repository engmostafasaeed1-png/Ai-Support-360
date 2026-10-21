import { Fragment } from 'react';
import mark from '@/assets/brand/mark.png.asset.json';
import stacked from '@/assets/brand/stacked.png.asset.json';
import horizontal from '@/assets/brand/horizontal.webp.asset.json';
import { parseMessage, type BrandImage, type Inline } from '@/lib/bulkMessaging';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const BRAND_SRC: Record<BrandImage, string> = { logo: horizontal.url, mark: mark.url, stacked: stacked.url };

function Parts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => p.kind === 'bold' ? <strong key={i}>{p.text}</strong>
        : p.kind === 'link' ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">{p.text}</a>
        : <Fragment key={i}>{p.text}</Fragment>)}
    </>
  );
}

/** Renders the limited message format (bold, lists, links, buttons, brand images). Text is never parsed as HTML. */
export default function MessageBody({ text, lang = 'en', className }: { text: string; lang?: 'en' | 'ar'; className?: string }) {
  const blocks = parseMessage(text);
  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className={cn('space-y-3 text-sm leading-relaxed break-words', className)}>
      {blocks.map((b, i) => {
        if (b.kind === 'p') return <p key={i} className="whitespace-pre-line"><Parts parts={b.parts} /></p>;
        if (b.kind === 'list') return <ul key={i} className="list-disc space-y-1 ps-5">{b.items.map((it, j) => <li key={j}><Parts parts={it} /></li>)}</ul>;
        if (b.kind === 'button') return <Button key={i} asChild size="sm"><a href={b.href} target="_blank" rel="noopener noreferrer nofollow">{b.label}</a></Button>;
        return <img key={i} src={BRAND_SRC[b.key]} alt={b.alt || 'AI Support 360'} className="h-10 w-auto" loading="lazy" />;
      })}
    </div>
  );
}
