import * as React from "react";

/**
 * Guards against duplicate React instances at runtime.
 *
 * Two React copies cause hooks (useState/useEffect/etc.) to be `null` on one
 * instance, producing the cryptic:
 *   "Cannot read properties of null (reading 'useEffect')"
 *
 * This runs once at app boot. If a previous module already stamped a different
 * React instance on `globalThis`, we log a loud, actionable error.
 */
const KEY = "__APP_REACT_SINGLETON__";

export function assertSingleReact(): void {
  const g = globalThis as any;
  const existing = g[KEY];

  if (existing && existing !== React) {
    const msg =
      "[reactSingletonGuard] Duplicate React instance detected. " +
      "Hooks will fail with null errors. " +
      "Likely causes: (1) stale Vite dep cache — delete node_modules/.vite, " +
      "(2) a dependency bundling its own React, " +
      "(3) a missing entry in vite.config.ts `resolve.dedupe`.";
    // eslint-disable-next-line no-console
    console.error(msg, { existingVersion: existing.version, currentVersion: React.version });
    if (import.meta.env.DEV) {
      throw new Error(msg);
    }
  } else {
    g[KEY] = React;
  }
}
