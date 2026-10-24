import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bold, Italic, List, ListOrdered, Heading3, Table2, Undo2, Redo2, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sanitizeBrdHtml, textToHtml } from '@/lib/brd/sanitize';
import { textLength, TBC_LABEL } from '../../../supabase/functions/_shared/brdModel';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (html: string) => void;
  dir: 'ltr' | 'rtl';
  label: string;
  max: number;
  readOnly?: boolean;
  placeholder?: string;
}

/**
 * Small rich-text editor for one BRD section: headings, bold/italic, bullet and numbered lists, simple tables,
 * "to be confirmed" marks, undo/redo (browser history), spell check. Output is always passed through the allowlist,
 * pasted content is cleaned, and the keyboard shortcuts of the browser (Ctrl+B, Ctrl+I, Ctrl+Z) keep working.
 */
export default function RichTextField({ value, onChange, dir, label, max, readOnly, placeholder }: Props) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  const [count, setCount] = useState(() => textLength(value));

  useEffect(() => {
    if (!ref.current) return;
    if (value !== last.current || ref.current.innerHTML === '') {
      ref.current.innerHTML = value;
      last.current = value;
      setCount(textLength(value));
    }
  }, [value]);

  const emit = () => {
    if (!ref.current) return;
    const clean = sanitizeBrdHtml(ref.current.innerHTML);
    last.current = clean;
    setCount(textLength(clean));
    onChange(clean);
  };

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
  };

  const insertHtml = (html: string) => {
    ref.current?.focus();
    document.execCommand('insertHTML', false, html);
    emit();
  };

  const tbcLabel = (i18n.language?.startsWith('ar') || dir === 'rtl') ? TBC_LABEL.ar : TBC_LABEL.en;
  const tools = [
    { icon: Heading3, label: t('brd.editor.heading'), run: () => exec('formatBlock', 'h4') },
    { icon: Bold, label: t('brd.editor.bold'), run: () => exec('bold') },
    { icon: Italic, label: t('brd.editor.italic'), run: () => exec('italic') },
    { icon: List, label: t('brd.editor.bullets'), run: () => exec('insertUnorderedList') },
    { icon: ListOrdered, label: t('brd.editor.numbered'), run: () => exec('insertOrderedList') },
    { icon: Table2, label: t('brd.editor.table'), run: () => insertHtml('<table><tbody><tr><th>&nbsp;</th><th>&nbsp;</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p></p>') },
    { icon: HelpCircle, label: t('brd.editor.tbc'), run: () => insertHtml(`<mark data-tbc="1">${tbcLabel}: </mark>&nbsp;`) },
    { icon: Undo2, label: t('brd.editor.undo'), run: () => exec('undo') },
    { icon: Redo2, label: t('brd.editor.redo'), run: () => exec('redo') },
  ];
  const over = count > max;

  return (
    <div className="rounded-xl border border-border bg-background">
      {!readOnly && (
        <div role="toolbar" aria-label={t('brd.editor.toolbar', { label })} className="flex flex-wrap gap-0.5 border-b border-border p-1">
          {tools.map(({ icon: Icon, label: l, run }) => (
            <Button key={l} type="button" variant="ghost" size="icon" className="h-8 w-8" title={l} aria-label={l}
              onMouseDown={(e) => e.preventDefault()} onClick={run}>
              <Icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
      )}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-readonly={readOnly || undefined}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        spellCheck
        dir={dir}
        lang={dir === 'rtl' ? 'ar' : 'en'}
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onPaste={(e) => {
          e.preventDefault();
          const html = e.clipboardData.getData('text/html');
          const text = e.clipboardData.getData('text/plain');
          insertHtml(html ? sanitizeBrdHtml(html) : textToHtml(text));
        }}
        className={cn(
          'brd-prose min-h-[96px] px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-b-xl',
          'empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground',
        )}
      />
      <div className={cn('flex justify-end px-3 pb-1.5 text-[11px]', over ? 'text-destructive' : 'text-muted-foreground')} aria-live="polite">
        {t('brd.editor.count', { count, max })}
      </div>
    </div>
  );
}
