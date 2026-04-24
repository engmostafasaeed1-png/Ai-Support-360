import { ExternalLink, LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import {
  getProviderTroubleshooting,
  type TroubleshootReason,
} from './providerTroubleshooting';
import type { MeetingProvider } from './MeetingLinkButton';
import { useTranslateTroubleshooting } from './TranslateTroubleshootingContext';

interface ProviderTroubleshootingPanelProps {
  provider: MeetingProvider;
  reason: TroubleshootReason;
  /** Visual density. `compact` is meant for inline use inside dialogs/alerts. */
  variant?: 'compact' | 'card';
}

/**
 * Presents provider-specific troubleshooting copy returned by
 * {@link getProviderTroubleshooting}. Safe to drop inside an Alert or Dialog.
 */
export default function ProviderTroubleshootingPanel({
  provider,
  reason,
  variant = 'compact',
}: ProviderTroubleshootingPanelProps) {
  const { t } = useTranslation();
  const guide = getProviderTroubleshooting(provider, reason);

  const Wrapper: React.ElementType = variant === 'card' ? 'section' : 'div';

  return (
    <Wrapper
      className={
        variant === 'card'
          ? 'rounded-lg border border-border/60 bg-muted/30 p-3 space-y-2'
          : 'space-y-2 text-sm'
      }
    >
      <div className="flex items-start gap-2">
        <LifeBuoy className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" aria-hidden="true" />
        <div className="flex-1 space-y-1">
          <p className="font-medium text-foreground">
            {t(`troubleshoot.${provider}.${reason}.headline`, {
              defaultValue: guide.headline,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(`troubleshoot.${provider}.${reason}.cause`, { defaultValue: guide.cause })}
          </p>
        </div>
      </div>
      <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground/90">
        {guide.steps.map((step, i) => (
          <li key={i}>
            {t(`troubleshoot.${provider}.${reason}.step.${i}`, { defaultValue: step })}
          </li>
        ))}
      </ol>
      {guide.helpUrl && (
        <Button
          variant="link"
          size="sm"
          className="px-0 h-auto"
          asChild
        >
          <a href={guide.helpUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
            {t('troubleshoot.help_link', {
              defaultValue: `Open ${guide.label} help center`,
              provider: t(`troubleshoot.provider_label.${provider}`, { defaultValue: guide.label }),
            })}
          </a>
        </Button>
      )}
    </Wrapper>
  );
}
