import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { ArrowRight, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useInRouterContext } from "react-router-dom";

import { cn } from "@/lib/utils";
import { ButtonBase, type ButtonBaseProps } from "./button-base";
import {
  BUSY_LABEL,
  blockedSentence,
  describeBlocked,
  moreStepsText,
  progressText,
  type BlockedInput,
  type Lang,
  type ResolvedBlock,
  type ResolvedReason,
} from "@/lib/blockedReasons";

export interface GuidedButtonProps extends ButtonBaseProps {
  /**
   * Why the button can not be used yet (catalogue key, reason object, or a list in step order; falsy = not blocked).
   * A blocked button stays focusable and tappable (aria-disabled, never the native disabled attribute), never runs
   * onClick or submits a form, and explains itself on hover, keyboard focus and tap.
   */
  reason?: BlockedInput;
  /** an action is running: native disabled + aria-busy + a spoken "Please wait…" (or busyLabel) */
  busy?: boolean;
  busyLabel?: string;
  /** "inline" also shows the reason as a small line under the button (important actions) */
  hint?: "popover" | "inline";
  /** optional "2 of 4 steps done" */
  progress?: { done: number; total: number };
  /** class of the wrapper used by the inline hint variant */
  wrapperClassName?: string;
  hintClassName?: string;
}

const BLOCKED_CLASSES =
  "opacity-50 cursor-not-allowed shadow-none hover:shadow-none hover:brightness-100 hover:translate-y-0 active:scale-100 active:translate-y-0";

const CLOSE_DELAY = 150;

function useLang(): Lang {
  const { i18n } = useTranslation();
  return i18n?.language?.startsWith("ar") ? "ar" : "en";
}

function NextStep({ step, onDone, className }: { step: ResolvedReason; onDone?: () => void; className?: string }) {
  const inRouter = useInRouterContext();
  if (!step.nextLabel) return null;
  const cls = cn(
    "inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  );
  const content = (
    <>
      {step.nextLabel}
      <ArrowRight className="h-3 w-3 shrink-0 rtl:rotate-180" aria-hidden="true" />
    </>
  );
  if (step.onNext) {
    return (
      <button type="button" className={cls} data-testid="blocked-next-step" onClick={() => { onDone?.(); step.onNext?.(); }}>
        {content}
      </button>
    );
  }
  if (!step.to) return null;
  if (inRouter) {
    return <Link to={step.to} className={cls} data-testid="blocked-next-step" onClick={() => onDone?.()}>{content}</Link>;
  }
  return <a href={step.to} className={cls} data-testid="blocked-next-step">{content}</a>;
}

function BlockedPanel({ block, lang, onDone }: { block: ResolvedBlock; lang: Lang; onDone: () => void }) {
  return (
    <div className="space-y-1.5 text-start">
      <p className="flex items-start gap-1.5 font-medium leading-snug text-popover-foreground" data-testid="blocked-reason">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span>{block.first.message}</span>
      </p>
      {block.progress && <p className="text-muted-foreground">{progressText(block.progress, lang)}</p>}
      <NextStep step={block.first} onDone={onDone} />
      {block.more.length > 0 && (
        <div className="border-t border-border/60 pt-1.5 text-muted-foreground">
          <p className="font-medium">{moreStepsText(block.more.length, lang)}</p>
          <ul className="mt-0.5 list-disc space-y-0.5 ps-4">
            {block.more.slice(0, 3).map((m, i) => <li key={`${m.key}-${i}`}>{m.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The shared button behaviour for blocked and busy states. Use it through `Button` (`reason` / `busy` props).
 */
export const GuidedButton = React.forwardRef<HTMLButtonElement, GuidedButtonProps>(
  (
    { reason, busy, busyLabel, hint = "popover", progress, wrapperClassName, hintClassName, className, children, onClick, disabled, ...rest },
    ref,
  ) => {
    const lang = useLang();
    const id = React.useId();
    const descId = `${id}-why`;
    const block = busy ? null : describeBlocked(reason ?? null, lang, progress);
    const [open, setOpen] = React.useState(false);
    const timer = React.useRef<number | undefined>(undefined);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const nextRef = React.useRef(false);

    const clear = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = undefined; };
    const closeSoon = () => { clear(); timer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY); };
    React.useEffect(() => clear, []);
    const isBlocked = !!block;
    React.useEffect(() => { if (!isBlocked) setOpen(false); }, [isBlocked]);

    const blocked = !!block;
    const sentence = block ? blockedSentence(block, lang) : "";
    const describedBy = [rest["aria-describedby"], blocked ? descId : undefined].filter(Boolean).join(" ") || undefined;

    // One element tree for every state (ready, busy, blocked) so the button keeps focus when its state changes.
    const button = (
      <PopoverPrimitive.Anchor asChild>
        <ButtonBase
          ref={ref}
          {...rest}
          className={blocked ? cn(className, BLOCKED_CLASSES) : className}
          disabled={!blocked && (busy || disabled) ? true : undefined}
          aria-busy={busy ? true : undefined}
          aria-disabled={blocked ? "true" : rest["aria-disabled"]}
          aria-describedby={describedBy}
          aria-expanded={blocked ? open : rest["aria-expanded"]}
          data-blocked={block?.first.key}
          onClick={(e) => {
            if (!blocked) { onClick?.(e); return; }
            // a blocked button never runs its action and never submits a form
            e.preventDefault();
            e.stopPropagation();
            clear();
            setOpen(true);
            // keyboard activation (Enter/Space has detail 0): move into the panel so the next step is reachable
            nextRef.current = e.detail === 0;
          }}
          onPointerEnter={(e) => { rest.onPointerEnter?.(e); if (blocked && e.pointerType === "mouse") { clear(); setOpen(true); } }}
          onPointerLeave={(e) => { rest.onPointerLeave?.(e); if (blocked && e.pointerType === "mouse") closeSoon(); }}
          onFocus={(e) => { rest.onFocus?.(e); if (blocked) { clear(); setOpen(true); } }}
          onBlur={(e) => {
            rest.onBlur?.(e);
            if (blocked && !contentRef.current?.contains(e.relatedTarget as Node | null)) closeSoon();
          }}
          onKeyDown={(e) => {
            rest.onKeyDown?.(e);
            if (blocked && e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
          }}
        >
          {children}
          {busy && <span className="sr-only">{busyLabel ?? BUSY_LABEL[lang]}</span>}
          {blocked && hint !== "inline" && <span id={descId} hidden>{sentence}</span>}
        </ButtonBase>
      </PopoverPrimitive.Anchor>
    );

    const popover = (
      <PopoverPrimitive.Root open={blocked && open} onOpenChange={setOpen}>
        {button}
        {block && (
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              ref={contentRef}
              side="top"
              align="center"
              sideOffset={6}
              collisionPadding={8}
              dir={lang === "ar" ? "rtl" : "ltr"}
              data-testid="blocked-popover"
              className="z-[60] max-w-[min(18rem,calc(100vw-1rem))] rounded-lg border border-border/60 bg-popover px-3 py-2.5 text-xs text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                if (nextRef.current) {
                  nextRef.current = false;
                  window.setTimeout(() => contentRef.current?.querySelector<HTMLElement>("[data-testid=blocked-next-step]")?.focus(), 0);
                }
              }}
              onCloseAutoFocus={(e) => e.preventDefault()}
              onPointerEnter={clear}
              onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon(); }}
              onFocus={clear}
              onBlur={(e) => { if (!contentRef.current?.contains(e.relatedTarget as Node | null)) closeSoon(); }}
            >
              <BlockedPanel block={block} lang={lang} onDone={() => setOpen(false)} />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        )}
      </PopoverPrimitive.Root>
    );

    if (hint !== "inline") return popover;
    return (
      <span className={cn("inline-flex flex-col items-start gap-1", wrapperClassName)}>
        {popover}
        {block && (
          <span id={descId} role="note" data-testid="blocked-hint" className={cn("flex max-w-md flex-wrap items-start gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground", hintClassName)}>
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{block.first.message}{block.more.length > 0 ? ` (${moreStepsText(block.more.length, lang)})` : ""}</span>
            <NextStep step={block.first} />
          </span>
        )}
      </span>
    );
  },
);
GuidedButton.displayName = "GuidedButton";

/** Inline "why" line for controls that are not buttons (menu items, tiles): same catalogue, same words. */
export function BlockedHint({ reason, className }: { reason: BlockedInput; className?: string }) {
  const lang = useLang();
  const block = describeBlocked(reason ?? null, lang);
  if (!block) return null;
  return (
    <span role="note" className={cn("flex items-start gap-1 text-xs text-muted-foreground", className)} data-testid="blocked-hint">
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{block.first.message}</span>
      <NextStep step={block.first} />
    </span>
  );
}
