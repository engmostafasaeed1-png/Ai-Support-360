import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { reportError } from '@/lib/errorReporter';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    reportError({
      level: 'fatal',
      source: 'ErrorBoundary',
      message: error.message || 'React render error',
      stack: error.stack,
      context: { componentStack: errorInfo.componentStack?.slice(0, 2000) },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="max-w-md w-full rounded-2xl border-border/50">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7 text-destructive" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Something went wrong</h2>
              <p className="text-sm text-muted-foreground">An unexpected error occurred. Please try again.</p>
              <Button onClick={() => window.location.reload()} className="w-full">
                Try Again
              </Button>
              <button
                onClick={() => this.setState(prev => ({ showDetails: !prev.showDetails }))}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {this.state.showDetails ? 'Hide' : 'Show'} Details
              </button>
              {this.state.showDetails && this.state.error && (
                <pre className="text-xs text-start bg-muted/50 rounded-lg p-3 overflow-auto max-h-40 text-muted-foreground">
                  {this.state.error.message}
                </pre>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
