import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Languages } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default';
}

const LANGUAGES = [
  { code: 'en-US', label: 'English', flag: '🇺🇸' },
  { code: 'ar-SA', label: 'العربية', flag: '🇸🇦' },
];

export default function VoiceInput({ onTranscript, disabled, className, size = 'default' }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [lang, setLang] = useState('en-US');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');

  const SpeechRecognition = typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

  const isSupported = !!SpeechRecognition;

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      toast.error('Voice input is not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    finalTranscriptRef.current = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) {
        finalTranscriptRef.current += final;
        onTranscript(finalTranscriptRef.current);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== 'aborted') {
        toast.error('Voice recognition error: ' + event.error);
      }
      stopListening();
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [SpeechRecognition, lang, onTranscript, stopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  if (!isSupported) return null;

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const btnSize = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {/* Language picker */}
      <Popover open={showLangPicker} onOpenChange={setShowLangPicker}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(btnSize, 'shrink-0 text-muted-foreground hover:text-foreground text-xs')}
            disabled={disabled || isListening}
            title="Change voice language"
          >
            <span className="text-sm">{LANGUAGES.find(l => l.code === lang)?.flag}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-36 p-1" align="end">
          {LANGUAGES.map(l => (
            <button
              key={l.code}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md hover:bg-muted transition-colors',
                lang === l.code && 'bg-accent/10 text-accent font-medium'
              )}
              onClick={() => { setLang(l.code); setShowLangPicker(false); }}
            >
              <span>{l.flag}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      {/* Mic button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          btnSize,
          'shrink-0 transition-all',
          isListening
            ? 'text-red-500 bg-red-500/10 hover:bg-red-500/20 animate-pulse'
            : 'text-muted-foreground hover:text-foreground'
        )}
        onClick={toggleListening}
        disabled={disabled}
        title={isListening ? 'Stop recording' : 'Start voice input'}
      >
        {isListening ? <MicOff className={iconSize} /> : <Mic className={iconSize} />}
      </Button>
    </div>
  );
}
