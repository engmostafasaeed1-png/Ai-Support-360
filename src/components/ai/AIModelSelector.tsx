import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Brain } from 'lucide-react';

// One model for the whole platform: GPT Astra 6 (the servers enforce it as well).
export const AI_MODELS = [
  { id: 'openai/gpt-6-astra', label: 'GPT Astra 6', provider: 'OpenAI', tier: 'premium' },
] as const;

export type AIModelId = typeof AI_MODELS[number]['id'];

export const DEFAULT_MODEL: AIModelId = 'openai/gpt-6-astra';

const tierColors: Record<string, string> = {
  fast: 'text-green-500',
  balanced: 'text-blue-500',
  premium: 'text-amber-500',
};

interface AIModelSelectorProps {
  value: AIModelId;
  onChange: (model: AIModelId) => void;
  compact?: boolean;
  className?: string;
}

export default function AIModelSelector({ value, onChange, compact = false, className = '' }: AIModelSelectorProps) {
  const { t } = useTranslation();

  // One model for everything: show it as a label instead of a drop-down with a single choice.
  if (AI_MODELS.length === 1) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 rounded-md border border-border/30 bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground ${className}`}
        title="All AI features use this model"
      >
        <Brain className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{AI_MODELS[0].label}</span>
      </div>
    );
  }

  if (compact) {
    return (
      <Select value={value} onValueChange={(v) => onChange(v as AIModelId)}>
        <SelectTrigger className={`h-7 text-[10px] w-auto min-w-[140px] gap-1 border-border/30 bg-muted/30 ${className}`}>
          <Brain className="w-3 h-3 text-muted-foreground shrink-0" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AI_MODELS.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              <span className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${tierColors[m.tier]} bg-current`} />
                {m.label}
                <span className="text-[10px] text-muted-foreground">{m.provider}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={(v) => onChange(v as AIModelId)}>
      <SelectTrigger className={`gap-2 ${className}`}>
        <Brain className="w-4 h-4 text-muted-foreground" />
        <SelectValue placeholder={t('ai.select_model', 'Select AI Model')} />
      </SelectTrigger>
      <SelectContent>
        {AI_MODELS.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${tierColors[m.tier]} bg-current`} />
              {m.label}
              <span className="text-xs text-muted-foreground">({m.provider})</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
