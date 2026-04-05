import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PartyPopper, X } from 'lucide-react';

export default function WelcomeBanner() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (searchParams.get('welcome') === 'true') {
      setVisible(true);
      // Clean the URL without re-rendering
      const next = new URLSearchParams(searchParams);
      next.delete('welcome');
      setSearchParams(next, { replace: true });
    }
  }, []);

  if (!visible) return null;

  return (
    <Card className="rounded-2xl border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 dark:border-green-800/40 overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/50 flex items-center justify-center shrink-0">
            <PartyPopper className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">
              {t('onboarding.welcome_title', '🎉 Welcome aboard!')}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('onboarding.welcome_body', 'Your profile setup is complete. You\'re all set to get started!')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setVisible(false)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
