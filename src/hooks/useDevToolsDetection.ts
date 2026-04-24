/**
 * Stub hook — DevTools detection has been removed.
 *
 * Why: All previous heuristics (window-size deltas, debugger-statement timing,
 * console.log getters) are trivially bypassed by anyone who can open DevTools
 * in the first place, so they only added a false sense of security while
 * occasionally causing false positives for legitimate users on small screens
 * or with browser extensions.
 *
 * Real protection for sensitive data must come from the backend (RLS,
 * server-side authorization, encrypted credentials), not the client.
 *
 * Kept as a no-op so existing callers don't break.
 */
export function useDevToolsDetection(): boolean {
  return false;
}
