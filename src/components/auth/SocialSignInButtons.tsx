import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SocialProvider } from '@/lib/socialSignin';

const ICONS: Record<SocialProvider, JSX.Element> = {
  google: (
    <svg className="w-4 h-4 me-2" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.560-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.490-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  ),
  apple: (
    <svg className="w-4 h-4 me-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.240 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  ),
  microsoft: (
    <svg className="w-4 h-4 me-2" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  ),
};
const LABELS: Record<SocialProvider, string> = { google: 'Google', apple: 'Apple', microsoft: 'Microsoft' };

interface Props {
  providers: SocialProvider[];
  loadingProvider: string | null;
  disabled?: boolean;
  onSelect: (provider: SocialProvider) => void;
}

/** Divider + provider buttons; renders nothing (not even the "or" divider) when no provider is enabled. */
export default function SocialSignInButtons({ providers, loadingProvider, disabled, onSelect }: Props) {
  const { t } = useTranslation();
  if (providers.length === 0) return null;
  return (
    <>
      <div className="flex items-center gap-3 w-full" aria-hidden="true" data-testid="social-divider">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">{t('auth.or_continue_with')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className={`grid gap-3 w-full ${providers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {providers.map((p) => (
          <Button
            key={p}
            type="button"
            variant="outline"
            className="h-11 rounded-xl hover:-translate-y-0.5"
            onClick={() => onSelect(p)}
            disabled={disabled || !!loadingProvider}
          >
            {loadingProvider === p ? <Loader2 className="w-4 h-4 me-2 animate-spin" /> : ICONS[p]}
            {LABELS[p]}
          </Button>
        ))}
      </div>
      {providers.includes('google') && (
        <p className="text-xs text-muted-foreground text-center">
          {t('auth.oauth_help', 'If Google sign-in fails, use a normal browser window (not a private window or an in-app browser) or sign up with your e-mail.')}
        </p>
      )}
    </>
  );
}
