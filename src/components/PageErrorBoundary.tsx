import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { reportError } from '@/lib/errorReporter';
import { isStaleChunkError, reloadForNewVersion, reloadJustStarted } from '@/lib/staleChunkReload';

interface BoundaryProps {
  children: React.ReactNode;
  /** Where "Go to dashboard" leads: the home page of this part of the portal. */
  homePath: string;
  /** A new value (the address of the page) clears the error, so the next page opens normally. */
  resetKey: string;
}

interface BoundaryState {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

const CLEAR: BoundaryState = { hasError: false, error: null, showDetails: false };

class Boundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = CLEAR;

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // A page file that no longer exists after a new Publish: reload once instead of reporting an error.
    if (isStaleChunkError(error.message) && (reloadForNewVersion() || reloadJustStarted())) return;
    console.error('PageErrorBoundary caught:', error, errorInfo);
    reportError({
      level: 'error',
      source: 'PageErrorBoundary',
      message: error.message || 'React render error',
      stack: error.stack,
      context: { componentStack: errorInfo.componentStack?.slice(0, 2000) },
    });
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) this.setState(CLEAR);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex items-center justify-center py-10" role="alert" data-testid="page-error">
        <Card className="w-full max-w-md rounded-2xl border-border/50">
          <CardContent className="space-y-4 p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10">
              <AlertTriangle className="h-7 w-7 text-destructive" />
            </div>
            <h2 className="text-xl font-bold text-foreground">This page could not be shown</h2>
            <p className="text-sm text-muted-foreground">
              Something went wrong on this page. The rest of the portal still works: use the menu, go to your dashboard or try again.
            </p>
            <div className="flex flex-col justify-center gap-2 sm:flex-row">
              <Button onClick={() => this.setState(CLEAR)}>Try again</Button>
              <Button variant="outline" asChild>
                <Link to={this.props.homePath}>Go to dashboard</Link>
              </Button>
            </div>
            <button
              type="button"
              onClick={() => this.setState((prev) => ({ ...prev, showDetails: !prev.showDetails }))}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {this.state.showDetails ? 'Hide' : 'Show'} details
            </button>
            {this.state.showDetails && this.state.error && (
              <pre className="max-h-40 overflow-auto rounded-lg bg-muted/50 p-3 text-start text-xs text-muted-foreground">
                {this.state.error.message}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
}

/** Put it around the <Outlet /> of a layout: a crash in one page then shows this card in the page area and keeps the menu, the header and the footer. */
export default function PageErrorBoundary({ children, homePath }: { children: React.ReactNode; homePath: string }) {
  const { pathname } = useLocation();
  return (
    <Boundary homePath={homePath} resetKey={pathname}>
      {children}
    </Boundary>
  );
}
