import "@testing-library/jest-dom";
import { expect } from "vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Components and hooks wait for a restored session before querying; unit tests run as a signed-in user
// unless a test imports the real hook (see useSessionReady.test.tsx).
vi.mock("@/hooks/useSessionReady", () => ({ useSessionReady: () => ({ ready: true, signedIn: true }) }));

// Blocked buttons (owner rule, Oct 25) use aria-disabled so they can still explain WHY on tap/focus; busy buttons use the
// native disabled attribute. `toBeBlocked` / `toBeUnblocked` accept either form.
const isBlocked = (el: Element) => (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
expect.extend({
  toBeBlocked(received: Element) {
    const pass = isBlocked(received);
    return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be blocked (disabled or aria-disabled="true")` };
  },
  toBeUnblocked(received: Element) {
    const pass = !isBlocked(received);
    return { pass, message: () => `expected element ${pass ? 'not ' : ''}to be unblocked` };
  },
});
