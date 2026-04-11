import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/pricing'];

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return true;
  if ((target as HTMLElement).isContentEditable) return true;
  if (target.closest('input, textarea, select, [contenteditable]')) return true;
  return false;
};

const ScreenProtection = () => {
  const location = useLocation();
  const isProtected = !PUBLIC_PATHS.some(p => location.pathname === p);

  useEffect(() => {
    if (!isProtected) return;

    const blockContext = (e: MouseEvent) => {
      if (!isEditableTarget(e.target)) e.preventDefault();
    };

    const blockSelect = (e: Event) => {
      if (!isEditableTarget(e.target)) e.preventDefault();
    };

    const blockDrag = (e: DragEvent) => e.preventDefault();

    const blockKeyboard = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const blocked = ['c', 'x', 'u', 's', 'p', 'a'].includes(e.key.toLowerCase());
      if (ctrl && blocked) e.preventDefault();
      if (e.key === 'F12') e.preventDefault();
      if (ctrl && e.shiftKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) e.preventDefault();
    };

    const blockCopy = (e: ClipboardEvent) => {
      if (!isEditableTarget(e.target)) {
        e.preventDefault();
        if (e.clipboardData) e.clipboardData.setData('text/plain', '');
      }
    };

    document.addEventListener('contextmenu', blockContext);
    document.addEventListener('selectstart', blockSelect);
    document.addEventListener('dragstart', blockDrag);
    document.addEventListener('keydown', blockKeyboard);
    document.addEventListener('copy', blockCopy);
    document.addEventListener('cut', blockCopy);

    return () => {
      document.removeEventListener('contextmenu', blockContext);
      document.removeEventListener('selectstart', blockSelect);
      document.removeEventListener('dragstart', blockDrag);
      document.removeEventListener('keydown', blockKeyboard);
      document.removeEventListener('copy', blockCopy);
      document.removeEventListener('cut', blockCopy);
    };
  }, [isProtected]);

  if (!isProtected) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[99998] pointer-events-none flex justify-center pb-2 opacity-30">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm rounded-full px-3 py-1">
        <ShieldCheck className="w-3 h-3" />
        <span>Protected by Qurtuba Talks — Unauthorized copying is prohibited</span>
      </div>
    </div>
  );
};

export default ScreenProtection;
