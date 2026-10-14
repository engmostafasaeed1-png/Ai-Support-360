import "@testing-library/jest-dom";

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
