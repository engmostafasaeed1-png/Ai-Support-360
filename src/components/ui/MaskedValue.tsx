import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface MaskedValueProps {
  value: string;
  visibleChars?: number;
  type?: 'email' | 'phone' | 'id' | 'card' | 'custom';
  showToggle?: boolean;
}

function maskValue(value: string, type: MaskedValueProps['type'], visibleChars = 4): string {
  if (!value) return '';
  if (type === 'email') {
    const [local, domain] = value.split('@');
    if (!domain) return '*'.repeat(value.length);
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 2))}@${domain}`;
  }
  if (type === 'phone') return value.slice(0, 4) + '*'.repeat(Math.max(value.length - 7, 3)) + value.slice(-3);
  if (type === 'card') return '*'.repeat(Math.max(value.length - 4, 4)) + value.slice(-4);
  return value.slice(0, visibleChars) + '*'.repeat(Math.max(value.length - visibleChars, 4));
}

export function MaskedValue({ value, visibleChars = 4, type = 'custom', showToggle = true }: MaskedValueProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className="inline-flex items-center gap-1 font-mono">
      <span className="select-none">{revealed ? value : maskValue(value, type, visibleChars)}</span>
      {showToggle && (
        <button
          onClick={() => setRevealed(r => !r)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label={revealed ? 'Hide value' : 'Show value'}
          type="button"
        >
          {revealed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
      )}
    </span>
  );
}
