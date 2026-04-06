import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";

const ScreenProtection = () => {
  const { t } = useTranslation();

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[99998] pointer-events-none flex justify-center pb-2 opacity-30">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm rounded-full px-3 py-1">
        <ShieldCheck className="w-3 h-3" />
        <span>{t('screen_protection.message', 'Content protected by Qurtuba')}</span>
      </div>
    </div>
  );
};

export default ScreenProtection;
