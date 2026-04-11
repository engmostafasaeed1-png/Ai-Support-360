import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Brain } from 'lucide-react';

export const AI_MODELS = [
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', provider: 'Google', tier: 'fast' },
  { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google', tier: 'balanced' },
  { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google', tier: 'premium' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', provider: 'OpenAI', tier: 'fast' },
  { id: 'openai/gpt-4o', label: 'GPT-4o', provider: 'OpenAI', tier: 'premium' },
] as const;

export type AIModelId = typeof AI_MODELS[number]['id'];

export const DEFAULT_MODEL: AIModelId = 'google/gemini-2.5-flash';

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
