import * as React from "react";

import { ButtonBase, buttonVariants, getButtonClasses, type ButtonBaseProps } from "./button-base";
import { GuidedButton, type GuidedButtonProps } from "./guided-button";

/**
 * The portal's button.
 *
 * Owner rule: a dimmed button always says WHY and WHAT to do next. Pass `reason` (from src/lib/blockedReasons.ts) instead
 * of `disabled` for anything the person can fix, and `busy` while an action runs. A bare `disabled={...}` fails the
 * guard test (src/test/disabledButtonsRule.test.ts) unless the tag carries a `disabled-ok:` comment.
 */
export type ButtonProps = GuidedButtonProps;

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>((props, ref) => {
  // The guided variant is chosen by the PRESENCE of the props (even when false), so the same element stays mounted
  // and keeps focus when a button turns blocked/busy and back.
  if ("reason" in props || "busy" in props || props.hint === "inline") return <GuidedButton ref={ref} {...props} />;
  return <ButtonBase ref={ref} {...(props as ButtonBaseProps)} />;
});
Button.displayName = "Button";

export { Button, ButtonBase, GuidedButton, buttonVariants, getButtonClasses };
