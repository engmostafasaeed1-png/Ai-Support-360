import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Paperclip, X, Image as ImageIcon, File } from 'lucide-react';
import VoiceInput from '@/components/ui/voice-input';

interface ChatInputProps {
  /** May answer false (or a promise of false) when the message could not be sent: the text then comes back into the box. */
  onSend: (content: string) => Promise<boolean | void> | boolean | void;
  onTyping: () => void;
  onFileUpload: (file: File) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, onTyping, onFileUpload, disabled }: ChatInputProps) {
  const [text, setText] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (pendingFile) {
      onFileUpload(pendingFile);
      setPendingFile(null);
      setPreviewUrl(null);
    }
    if (text.trim()) {
      const content = text.trim();
      setText('');
      // a failed send gives the text back (unless something new has been typed in the meantime)
      void Promise.resolve(onSend(content)).then((ok) => {
        if (ok === false) setText((current) => (current.trim() ? current : content));
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    onTyping();
  };

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
    e.target.value = '';
  }, []);

  const clearFile = () => {
    setPendingFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const canSend = text.trim().length > 0 || pendingFile;

  return (
    <div className="border-t border-border/50 bg-card/50 p-3">
      {/* File preview */}
      {pendingFile && (
        <div className="mb-2 flex items-center gap-2 bg-muted/30 rounded-lg p-2">
          {previewUrl ? (
            <img src={previewUrl} alt="preview" className="w-12 h-12 rounded object-cover" />
          ) : (
            <div className="w-12 h-12 rounded bg-accent/10 flex items-center justify-center">
              <File className="w-5 h-5 text-accent" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{pendingFile.name}</p>
            <p className="text-[10px] text-muted-foreground">{(pendingFile.size / 1024).toFixed(0)} KB</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearFile}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          type="file"
          ref={fileRef}
          className="hidden"
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <Paperclip className="w-4 h-4" />
        </Button>

        <textarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={disabled}
          className="flex-1 resize-none bg-muted/30 border border-border/50 rounded-xl px-3.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent min-h-[36px] max-h-[120px]"
          style={{ height: 'auto', overflow: 'hidden' }}
          onInput={(e) => {
            const t = e.currentTarget;
            t.style.height = 'auto';
            t.style.height = Math.min(t.scrollHeight, 120) + 'px';
          }}
        />

        <VoiceInput
          onTranscript={(t) => setText(t)}
          disabled={disabled}
        />

        <Button
          size="icon"
          className="h-9 w-9 shrink-0 gradient-primary border-0"
          onClick={handleSend}
          disabled={!canSend || disabled}
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
