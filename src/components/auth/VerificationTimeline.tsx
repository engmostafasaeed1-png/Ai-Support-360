import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, Loader2, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuthEmailExpiry } from '@/hooks/useAuthEmailExpiry';

interface VerificationTimelineProps {
  sentAt: Date;
  /** Verification link lifetime in minutes (Supabase default = 1440 / 24h) */
  expiresInMinutes?: number;
  className?: string;
  /** When provided, an expired-state CTA is rendered inside the timeline. */
  onResend?: () => void | Promise<void>;
  /** Seconds remaining before resend is allowed again. 0 = ready. */
  resendCooldown?: number;
  /** Resend in flight. */
  resending?: boolean;
}

const formatTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const pad = (n: number) => n.toString().padStart(2, '0');

export const formatRelative = (ms: number) => {
  if (ms <= 0) return 'expired';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s left`;
  if (m > 0) return `${m}m ${pad(s)}s left`;
  return `${s}s left`;
};

export const computeTimelineState = (
  sentAt: Date,
  expiresInMinutes: number,
  now: Date = new Date(),
) => {
  const expiresAt = new Date(sentAt.getTime() + expiresInMinutes * 60 * 1000);
  const remainingMs = expiresAt.getTime() - now.getTime();
  const elapsedMs = now.getTime() - sentAt.getTime();
  const totalMs = expiresAt.getTime() - sentAt.getTime();
  const progress = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  const expired = remainingMs <= 0;
  const expiringSoon = !expired && remainingMs < 60 * 60 * 1000;
  return { expiresAt, remainingMs, elapsedMs, totalMs, progress, expired, expiringSoon };
};

export default function VerificationTimeline({
  sentAt,
  expiresInMinutes,
  className,
  onResend,
  resendCooldown = 0,
  resending = false,
}: VerificationTimelineProps) {
  const fetchedExpiry = useAuthEmailExpiry();
  const effectiveExpiry = expiresInMinutes ?? fetchedExpiry;
  const expiresAt = new Date(sentAt.getTime() + effectiveExpiry * 60 * 1000);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = expiresAt.getTime() - now.getTime();
  const elapsedMs = now.getTime() - sentAt.getTime();
  const totalMs = expiresAt.getTime() - sentAt.getTime();
  const progress = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  const expired = remainingMs <= 0;
  const expiringSoon = !expired && remainingMs < 60 * 60 * 1000; // < 1h

  return (
    <div className={cn('rounded-xl border border-border/50 bg-muted/30 p-3 space-y-3', className)}>
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">Email sent</p>
          <p className="text-[11px] text-muted-foreground">
            {formatTime(sentAt)} • {sentAt.toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="relative ms-2 ps-4 border-s-2 border-dashed border-border">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              'h-full transition-all',
              expired ? 'bg-destructive' : expiringSoon ? 'bg-orange-500' : 'bg-primary',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex items-start gap-3">
        {expired ? (
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
        ) : (
          <Clock
            className={cn(
              'w-4 h-4 mt-0.5 shrink-0',
              expiringSoon ? 'text-orange-500' : 'text-muted-foreground',
            )}
          />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-xs font-medium',
              expired ? 'text-destructive' : 'text-foreground',
            )}
          >
            {expired ? 'Link expired' : 'Link expires'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {formatTime(expiresAt)} • {expiresAt.toLocaleDateString()}{' '}
            <span
              className={cn(
                'ms-1',
                expired
                  ? 'text-destructive font-medium'
                  : expiringSoon
                    ? 'text-orange-500 font-medium'
                    : '',
              )}
            >
              ({formatRelative(remainingMs)})
            </span>
          </p>
          {expired && !onResend && (
            <p className="text-[11px] text-destructive mt-1">
              Tap "Resend" to get a new verification link.
            </p>
          )}
        </div>
      </div>

      {expired && onResend && (
        <div className="pt-1">
          <Button
            type="button"
            onClick={() => { void onResend(); }}
            disabled={resending || resendCooldown > 0}
            className="w-full h-10 rounded-xl gradient-primary border-0 shadow-premium hover:shadow-xl transition-all gap-2"
          >
            {resending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {resending
              ? 'Sending new link...'
              : resendCooldown > 0
                ? `Resend available in ${resendCooldown}s`
                : 'Resend verification email'}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center mt-1.5">
            Your previous link is no longer valid.
          </p>
        </div>
      )}
    </div>
  );
}
