import { useTranslation } from 'react-i18next';
import { useCallback, useEffect } from 'react';

export function useLanguage() {
  const { i18n } = useTranslation();

  const isRTL = i18n.language?.startsWith('ar');
  const currentLang = i18n.language?.startsWith('ar') ? 'ar' : 'en';

  useEffect(() => {
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
    document.documentElement.lang = currentLang;
  }, [isRTL, currentLang]);

  const toggleLanguage = useCallback(() => {
    const newLang = currentLang === 'en' ? 'ar' : 'en';
    i18n.changeLanguage(newLang);
  }, [currentLang, i18n]);

  return { isRTL, currentLang, toggleLanguage };
}
