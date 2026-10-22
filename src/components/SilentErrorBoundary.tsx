import React from 'react';

/** For optional background helpers (no visible output): an error inside renders nothing instead of breaking the page. */
export default class SilentErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) console.warn('Optional helper failed:', error);
  }
  render() { return this.state.failed ? null : this.props.children; }
}
