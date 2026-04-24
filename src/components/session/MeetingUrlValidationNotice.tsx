import { useEffect, useMemo } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ProviderTroubleshootingPanel from './ProviderTroubleshootingPanel';
import OpenInNewTabButton from './OpenInNewTabButton';
import { validateMeetingUrl } from '@/lib/meetingUrlValidation';
import { logProviderEvent } from '@/lib/diagnostics';

interface MeetingUrlValidationNoticeProps {
  url: string | null | undefined;
  sessionId?: string;
}

/**
 * Automatically validates a meeting URL (domain, format, expiration hints)
 * and renders the provider-specific invalid-link troubleshooting panel when
 * the URL fails validation. Renders nothing when the URL is valid.
 */
export default function MeetingUrlValidationNotice({
  url,
  sessionId,
}: MeetingUrlValidationNoticeProps) {
  const { t } = useTranslation();
  const result = useMemo(() => validateMeetingUrl(url), [url]);

  useEffect(() => {
    if (!result.ok) {
      logProviderEvent(
        'invalid_url',
        {
          provider: result.provider,
          url: url ?? '',
          issues: result.issues,
          sessionId,
        },
        'warn'
      );
    }
  }, [result.ok, result.provider, result.issues, url, sessionId]);

  if (result.ok) return null;

  const expired = result.expirationHint;
  const Icon = expired ? Clock : AlertTriangle;

  return (
    <Alert variant="destructive" className="space-y-2">
      <Icon className="h-4 w-4" />
      <AlertTitle>
        {expired
          ? t('meeting_url.expired_title', { defaultValue: 'This meeting link may be expired' })
          : t('meeting_url.invalid_title', { defaultValue: 'The meeting link looks invalid' })}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-sm">
          {result.summary
            ? t(`meeting_url.summary.${result.issues[0]}`, { defaultValue: result.summary })
            : t('meeting_url.summary_default', {
                defaultValue: 'We could not verify this meeting URL.',
              })}
        </p>
        <ProviderTroubleshootingPanel
          provider={result.provider}
          reason="invalid_url"
          variant="card"
        />
        {url ? (
          <div className="flex flex-wrap gap-2">
            <OpenInNewTabButton
              url={url}
              sessionId={sessionId}
              provider={result.provider}
              reason="invalid_url"
              size="sm"
              variant="outline"
            />
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
