import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium select-none ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.98] active:translate-y-px motion-reduce:transition-none motion-reduce:transform-none disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:transform-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-primary to-primary-shade text-primary-foreground shadow-sm shadow-primary/25 hover:shadow-md hover:shadow-primary/25 hover:brightness-110 hover:-translate-y-0.5",
        destructive:
          "bg-gradient-to-b from-destructive to-destructive-shade text-destructive-foreground shadow-sm shadow-destructive/25 hover:shadow-md hover:shadow-destructive/25 hover:brightness-110 hover:-translate-y-0.5",
        outline: "border border-border bg-transparent hover:bg-muted hover:border-primary/40",
        secondary: "bg-primary/10 text-primary hover:bg-primary/[0.16]",
        ghost: "bg-transparent hover:bg-muted",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-9 rounded-lg px-4",
        lg: "h-12 px-7 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/** Caller-owned backgrounds must not be covered by the variant's gradient image. */
const OWN_GRADIENT = /(^|\s)gradient-primary(\s|$)/;
const VARIANT_GRADIENT = /(?:^|\s)(?:bg-gradient-to-b|from-\S+|to-\S+)(?=\s|$)/g;
// Use Tailwind's merge groups to distinguish base colours from hover colours,
// background images, clipping and other bg-* utilities (including arbitrary colours).
const BACKGROUND_PROBE = "bg-[color:var(--button-background-probe)]";

export function getButtonClasses(opts: { variant?: VariantProps<typeof buttonVariants>["variant"]; size?: VariantProps<typeof buttonVariants>["size"]; className?: string }) {
  const classes = buttonVariants({ variant: opts.variant, size: opts.size });
  const ownsBackground = opts.className && (
    OWN_GRADIENT.test(opts.className) ||
    !cn(BACKGROUND_PROBE, opts.className).split(/\s+/).includes(BACKGROUND_PROBE)
  );
  return cn(ownsBackground ? classes.replace(VARIANT_GRADIENT, "") : classes, opts.className);
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={getButtonClasses({ variant, size, className })} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
