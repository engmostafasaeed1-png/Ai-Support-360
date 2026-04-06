import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

const ScreenProtection = () => {
  const { t } = useTranslation();
  const devtoolsCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // 1. Block right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // 2. Block PrintScreen, DevTools, View Source shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen") {
        e.preventDefault();
        navigator.clipboard?.writeText?.("").catch(() => {});
      }
      if (e.key === "F12") {
        e.preventDefault();
        return;
      }
      if (e.ctrlKey && e.shiftKey && ["i", "I", "j", "J", "c", "C", "s", "S"].includes(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.ctrlKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
        return;
      }
      if (e.metaKey && e.altKey && ["i", "I"].includes(e.key)) {
        e.preventDefault();
        return;
      }
      if (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key)) {
        e.preventDefault();
      }
    };

    // 3. Blur content when window loses focus
    const handleVisibilityChange = () => {
      const root = document.getElementById("screen-protect-overlay");
      if (root) {
        root.style.display = document.hidden ? "flex" : "none";
      }
    };

    // 4. Block drag
    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    // 5. Block copy/cut
    const handleCopyCut = (e: ClipboardEvent) => {
      e.preventDefault();
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("copy", handleCopyCut);
    document.addEventListener("cut", handleCopyCut);

    // CSS protection
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("dragstart", handleDragStart);
      document.removeEventListener("copy", handleCopyCut);
      document.removeEventListener("cut", handleCopyCut);
      if (devtoolsCheckRef.current) clearInterval(devtoolsCheckRef.current);
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
    };
  }, []);

  return (
    <>
      <div
        id="screen-protect-overlay"
        style={{ display: "none" }}
        className="fixed inset-0 z-[99999] bg-background flex items-center justify-center"
      >
        <p className="text-muted-foreground text-lg font-medium">
          {t('screen_protection.message', 'Content protected')}
        </p>
      </div>
      <div
        className="fixed inset-0 z-[99998] pointer-events-none select-none"
        aria-hidden="true"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 200px, hsla(var(--foreground) / 0.015) 200px, hsla(var(--foreground) / 0.015) 201px)",
        }}
      />
    </>
  );
};

export default ScreenProtection;
