import { forwardRef } from "react";
import { MessageCircle } from "lucide-react";
import { useDraggableFab } from "@/hooks/useDraggableFab";

const WHATSAPP_NUMBER = import.meta.env.VITE_WHATSAPP_NUMBER || "966568797024";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Hello, I'd like to get SAP consulting support.")}`;

const WhatsAppButton = forwardRef<HTMLAnchorElement>((_, ref) => {
  const { style, onPointerDown, isDragging } = useDraggableFab({
    storageKey: "fab-pos-whatsapp",
    size: 56,
  });

  return (
    <a
      ref={ref}
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={onPointerDown}
      onClick={(e) => { if (isDragging) { e.preventDefault(); e.stopPropagation(); } }}
      style={style}
      className="fixed bottom-20 md:bottom-6 start-4 z-[70] w-14 h-14 rounded-full bg-[#25D366] hover:bg-[#20bd5a] text-white flex items-center justify-center shadow-lg shadow-[#25D366]/30 transition-transform hover:scale-110 active:scale-95 select-none"
      aria-label="Chat on WhatsApp (drag to move)"
      title="Chat on WhatsApp — drag to move"
      draggable={false}
    >
      <MessageCircle className="w-6 h-6 pointer-events-none" />
    </a>
  );
});

WhatsAppButton.displayName = "WhatsAppButton";

export default WhatsAppButton;
