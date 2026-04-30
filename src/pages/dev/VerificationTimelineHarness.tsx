/**
 * Dev-only test harness for <VerificationTimeline />.
 *
 * Mounted at `/dev/verification-timeline` in non-production builds so Playwright
 * can drive deterministic states via query params:
 *
 *   ?sentMinutesAgo=5&expiresInMinutes=1440        → fresh / active
 *   ?sentMinutesAgo=1430&expiresInMinutes=1440     → expiring soon (10m left)
 *   ?sentMinutesAgo=1500&expiresInMinutes=1440     → expired
 *   ?cooldown=42                                   → resend cooldown
 *   ?resending=1                                   → in-flight resend
 *
 * Excluded from production via the App.tsx route guard.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import VerificationTimeline from '@/components/auth/VerificationTimeline';

export default function VerificationTimelineHarness() {
  const [params] = useSearchParams();
  const sentMinutesAgo = Number(params.get('sentMinutesAgo') ?? '5');
  const expiresInMinutes = Number(params.get('expiresInMinutes') ?? '1440');
  const initialCooldown = Number(params.get('cooldown') ?? '0');
  const resending = params.get('resending') === '1';
  const showResend = params.get('showResend') !== '0';

  const sentAt = useMemo(
    () => new Date(Date.now() - sentMinutesAgo * 60_000),
    [sentMinutesAgo],
  );

  const [cooldown, setCooldown] = useState(initialCooldown);
  const [clicks, setClicks] = useState(0);

  const handleResend = () => {
    setClicks((c) => c + 1);
    setCooldown(60);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-md mx-auto space-y-4">
        <h1 className="text-lg font-semibold">VerificationTimeline harness</h1>
        <div data-testid="harness-meta" className="text-xs text-muted-foreground">
          sentMinutesAgo={sentMinutesAgo} expiresInMinutes={expiresInMinutes}{' '}
          cooldown={cooldown} resending={String(resending)} clicks={clicks}
        </div>
        <VerificationTimeline
          sentAt={sentAt}
          expiresInMinutes={expiresInMinutes}
          onResend={showResend ? handleResend : undefined}
          resendCooldown={cooldown}
          resending={resending}
        />
        <button
          type="button"
          data-testid="reset-cooldown"
          onClick={() => setCooldown(0)}
          className="text-xs underline text-muted-foreground"
        >
          reset cooldown
        </button>
      </div>
    </div>
  );
}
