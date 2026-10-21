import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';

// English ships with the app; the Arabic texts are a separate download fetched only when Arabic is used
// (before the first paint for Arabic visitors, see main.tsx, and before any switch to Arabic).
let arabicLoad: Promise<void> | null = null;
export function loadArabic(): Promise<void> {
  if (i18n.hasResourceBundle('ar', 'translation')) return Promise.resolve();
  arabicLoad ??= import('./locales/ar.json')
    .then((m) => { i18n.addResourceBundle('ar', 'translation', (m as { default: object }).default ?? m, true, true); })
    .catch((error) => { arabicLoad = null; throw error; });
  return arabicLoad;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    partialBundledLanguages: true,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

// Every switch to Arabic (language menus, profile preference, ...) waits for the Arabic texts first.
const changeLanguage = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = ((lng?: string, callback?: Parameters<typeof changeLanguage>[1]) => {
  if (lng?.startsWith('ar')) {
    return loadArabic().catch(() => undefined).then(() => changeLanguage(lng, callback));
  }
  return changeLanguage(lng, callback);
}) as typeof i18n.changeLanguage;

/** Resolves when the texts for the detected language are ready (immediately for English). */
export const i18nReady: Promise<void> = i18n.language?.startsWith('ar') ? loadArabic().catch(() => undefined) : Promise.resolve();

export default i18n;
