import 'vitest';

interface BlockedMatchers<R = unknown> {
  /** Disabled natively (busy) or via aria-disabled="true" (blocked with a reason). */
  toBeBlocked(): R;
  toBeUnblocked(): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends BlockedMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends BlockedMatchers {}
}
