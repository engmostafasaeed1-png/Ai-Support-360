import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/errorReporter';

function SignupProblem({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4" role="alert">
      <div className="max-w-md w-full rounded-2xl border border-border/60 bg-card p-6 sm:p-8 text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6 text-destructive" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-foreground">{t('signup_safe.title', 'The sign-up form could not be shown')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('signup_safe.body', 'Something went wrong while loading this page. Reload to try again. If you already have an account, you can sign in instead.')}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="w-4 h-4" aria-hidden="true" />{t('signup_safe.reload', 'Reload')}
          </Button>
          <Button variant="outline" onClick={onRetry}>{t('signup_safe.retry', 'Try again')}</Button>
        </div>
        <p className="text-sm">
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">{t('signup_safe.login', 'Already have an account? Sign in')}</Link>
        </p>
      </div>
    </div>
  );
}

/** Keeps a sign-up error inside the page frame (header and footer stay) with Reload and a link to sign in. */
export default class SignupErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) console.error('Sign-up page error:', error);
    try {
      reportError({
        level: 'fatal',
        source: 'SignupErrorBoundary',
        message: error.message || 'Sign-up render error',
        stack: error.stack,
        context: { componentStack: info.componentStack?.slice(0, 2000) },
      });
    } catch { /* reporting is best effort */ }
  }
  render() {
    return this.state.failed ? <SignupProblem onRetry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
