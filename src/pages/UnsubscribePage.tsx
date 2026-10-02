import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, MailX } from 'lucide-react';

type Status = 'loading' | 'valid' | 'already' | 'invalid' | 'submitting' | 'success' | 'error';

const FUNCTION_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/handle-email-unsubscribe`;

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const email = params.get('email');
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!token && !email) {
      setStatus('invalid');
      setErrorMsg('Missing unsubscribe token.');
      return;
    }

    (async () => {
      try {
        const qs = new URLSearchParams();
        if (token) qs.set('token', token);
        if (email) qs.set('email', email);
        const res = await fetch(`${FUNCTION_URL}?${qs.toString()}`, {
          method: 'GET',
        });
        const data = await res.json();
        if (data.valid) {
          setStatus('valid');
        } else if (data.reason === 'already_unsubscribed') {
          setStatus('already');
        } else {
          setStatus('invalid');
          setErrorMsg(data.error || 'This unsubscribe link is invalid or has expired.');
        }
      } catch {
        setStatus('invalid');
        setErrorMsg('Could not verify the unsubscribe link.');
      }
    })();
  }, [token, email]);

  const handleConfirm = async () => {
    if (!token && !email) return;
    setStatus('submitting');
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, email }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus('success');
      } else if (data.reason === 'already_unsubscribed') {
        setStatus('already');
      } else {
        setStatus('error');
        setErrorMsg(data.error || 'Failed to process your unsubscribe request.');
      }
    } catch {
      setStatus('error');
      setErrorMsg('Network error. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            {status === 'success' || status === 'already' ? (
              <CheckCircle2 className="h-6 w-6 text-primary" />
            ) : status === 'invalid' || status === 'error' ? (
              <XCircle className="h-6 w-6 text-destructive" />
            ) : (
              <MailX className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            {status === 'loading' && 'Verifying link…'}
            {status === 'valid' && 'Unsubscribe from emails'}
            {status === 'submitting' && 'Processing…'}
            {status === 'success' && 'You have been unsubscribed'}
            {status === 'already' && 'Already unsubscribed'}
            {status === 'invalid' && 'Invalid link'}
            {status === 'error' && 'Something went wrong'}
          </h1>
          <CardDescription>
            {status === 'valid' &&
              'Click below to stop receiving emails from us at this address.'}
            {status === 'success' &&
              "You won't receive further emails from us at this address."}
            {status === 'already' &&
              'This email address has already been unsubscribed.'}
            {(status === 'invalid' || status === 'error') && errorMsg}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          {(status === 'loading' || status === 'submitting') && (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
          {status === 'valid' && (
            <Button onClick={handleConfirm} variant="destructive">
              Confirm unsubscribe
            </Button>
          )}
          {status === 'error' && (
            <Button onClick={handleConfirm} variant="outline">
              Try again
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
