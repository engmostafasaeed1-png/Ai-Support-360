import { cn } from '@/lib/utils';

/** Five small bars that follow the microphone loudness (0..1). Decorative: the status text says what is happening. */
export default function VoiceLevelMeter({ level, active = true, className }: { level: number; active?: boolean; className?: string }) {
  const bars = [0.12, 0.3, 0.5, 0.7, 0.88];
  return (
    <span aria-hidden="true" className={cn('inline-flex items-end gap-0.5 h-4', className)}>
      {bars.map((at, i) => (
        <span
          key={i}
          className={cn('w-1 rounded-full transition-all duration-75', active && level >= at ? 'bg-success' : 'bg-muted-foreground/30')}
          style={{ height: `${30 + i * 17}%` }}
        />
      ))}
    </span>
  );
}
