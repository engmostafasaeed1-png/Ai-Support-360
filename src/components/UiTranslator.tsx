import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { startUiTranslator } from '@/lib/uiTranslator';
import { cachedUiTranslations, refreshUiTranslations } from '@/lib/uiTranslations';

/**
 * In Arabic mode a large part of the portal is English text that is written directly in the screens.
 * This component replaces that text with the Arabic text of the table ui_translations (see src/lib/uiTranslator.ts).
 * It shows nothing itself, and when the language is not Arabic it does nothing.
 */
export default function UiTranslator() {
  const { i18n } = useTranslation();
  const lang = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);

  useEffect(() => {
    if (lang !== 'ar') return undefined;
    let cancelled = false;
    const translator = startUiTranslator(cachedUiTranslations('ar') ?? {});
    void refreshUiTranslations('ar').then((fresh) => {
      if (!cancelled && fresh) translator.setDictionary(fresh);
    });
    return () => {
      cancelled = true;
      translator.stop();
    };
  }, [lang]);

  return null;
}
