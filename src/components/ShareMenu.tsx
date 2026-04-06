import { useState } from "react";
import { Share2, Link2, Mail, Check, MessageCircle, Linkedin, Twitter, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";

interface ShareMenuProps {
  title: string;
  text?: string;
  url?: string;
  variant?: "outline" | "ghost" | "default";
  size?: "sm" | "default" | "icon";
  className?: string;
  details?: { label: string; value: string }[];
  onDownload?: () => void;
}

const ShareMenu = ({ title, text, url, variant = "outline", size = "default", className, details, onDownload }: ShareMenuProps) => {
  const [copied, setCopied] = useState(false);
  const shareUrl = url || window.location.href;

  const buildDetailText = () => {
    if (!details || details.length === 0) return text || title;
    const detailLines = details.map(d => `• ${d.label}: ${d.value}`).join("\n");
    return `${text || title}\n\n${detailLines}`;
  };

  const handleCopyLink = async () => {
    try {
      const fullText = `${buildDetailText()}\n\n${shareUrl}`;
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      toast({ title: "Copied to clipboard", description: "Link and details copied." });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: buildDetailText(), url: shareUrl });
      } catch (e: any) {
        if (e.name !== "AbortError") handleCopyLink();
      }
    } else {
      handleCopyLink();
    }
  };

  const handleEmail = () => {
    const subject = encodeURIComponent(title);
    const body = encodeURIComponent(`${buildDetailText()}\n\n${shareUrl}`);
    window.open(`mailto:?subject=${subject}&body=${body}`, "_self");
  };

  const handleWhatsApp = () => {
    const msg = encodeURIComponent(`${buildDetailText()}\n\n${shareUrl}`);
    window.open(`https://wa.me/?text=${msg}`, "_blank");
  };

  const handleLinkedIn = () => {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`, "_blank");
  };

  const handleTwitter = () => {
    const tweetText = encodeURIComponent(`${title}\n${text || ""}`);
    window.open(`https://twitter.com/intent/tweet?text=${tweetText}&url=${encodeURIComponent(shareUrl)}`, "_blank");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} className={className}>
          <Share2 className="w-4 h-4" />
          {size !== "icon" && <span className="ml-1.5">Share</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Share via</DropdownMenuLabel>
        <DropdownMenuItem onClick={handleCopyLink} className="gap-2 cursor-pointer">
          {copied ? <Check className="w-4 h-4 text-primary" /> : <Link2 className="w-4 h-4" />}
          {copied ? "Copied!" : "Copy link & details"}
        </DropdownMenuItem>
        {typeof navigator.share === "function" && (
          <DropdownMenuItem onClick={handleNativeShare} className="gap-2 cursor-pointer">
            <Share2 className="w-4 h-4" />Share via device...
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={handleEmail} className="gap-2 cursor-pointer">
          <Mail className="w-4 h-4" />Email
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleWhatsApp} className="gap-2 cursor-pointer">
          <MessageCircle className="w-4 h-4" />WhatsApp
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleLinkedIn} className="gap-2 cursor-pointer">
          <Linkedin className="w-4 h-4" />LinkedIn
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleTwitter} className="gap-2 cursor-pointer">
          <Twitter className="w-4 h-4" />X (Twitter)
        </DropdownMenuItem>
        {onDownload && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Export</DropdownMenuLabel>
            <DropdownMenuItem onClick={onDownload} className="gap-2 cursor-pointer">
              <Download className="w-4 h-4" />Download
            </DropdownMenuItem>
          </>
        )}
        {details && details.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Included Details</DropdownMenuLabel>
            <div className="px-2 py-1 space-y-0.5">
              {details.map((d, i) => (
                <div key={i} className="text-[10px] text-muted-foreground flex justify-between">
                  <span>{d.label}</span>
                  <span className="text-foreground font-medium">{d.value}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ShareMenu;
