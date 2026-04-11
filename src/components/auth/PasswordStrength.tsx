import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface Props {
  password: string;
}

function getStrength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const levels = [
  { label: 'auth.strength_weak', color: 'bg-destructive' },
  { label: 'auth.strength_fair', color: 'bg-orange-500' },
  { label: 'auth.strength_good', color: 'bg-yellow-500' },
  { label: 'auth.strength_strong', color: 'bg-green-500' },
];

export default function PasswordStrength({ password }: Props) {
  const { t } = useTranslation();
  const strength = useMemo(() => getStrength(password), [password]);

  if (!password) return null;

  const level = levels[Math.max(strength - 1, 0)];

  return (
    <div className="space-y-1.5 mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              i <= strength ? level.color : 'bg-border'
            )}
          />
        ))}
      </div>
      <p className={cn('text-[10px]', strength <= 1 ? 'text-destructive' : 'text-muted-foreground')}>
        {t(level.label, level.label.split('_').pop() || '')}
      </p>
    </div>
  );
}
