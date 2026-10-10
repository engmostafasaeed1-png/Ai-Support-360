import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';

// the word "Arabic" in Arabic letters
const ARABIC_NAME = String.fromCharCode(0x0627, 0x0644, 0x0639, 0x0631, 0x0628, 0x064a, 0x0629);

/** Switches the interface between English and Arabic (the choice is remembered by the browser). */
export default function LanguageSwitchButton() {
  const { currentLang, toggleLanguage } = useLanguage();
  const label = currentLang === 'en' ? ARABIC_NAME : 'English';
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-9 gap-1.5 px-2 text-xs"
      onClick={toggleLanguage}
      aria-label={currentLang === 'en' ? 'Switch to Arabic' : 'Switch to English'}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
