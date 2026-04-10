import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, ArrowRight } from 'lucide-react';

const WORKFLOW_STEPS = [
  { key: 'new', label: 'New', color: 'bg-accent' },
  { key: 'triaging', label: 'Triaging', color: 'bg-indigo-500' },
  { key: 'planning', label: 'Planning', color: 'bg-violet-500' },
  { key: 'pending_approval', label: 'Approval', color: 'bg-amber-500' },
  { key: 'approved', label: 'Approved', color: 'bg-emerald-500' },
  { key: 'in_progress', label: 'In Progress', color: 'bg-blue-500' },
  { key: 'testing', label: 'Testing', color: 'bg-cyan-500' },
  { key: 'resolved', label: 'Resolved', color: 'bg-green-500' },
  { key: 'closed', label: 'Closed', color: 'bg-muted-foreground' },
];

// Map non-linear statuses to closest step
const STATUS_MAP: Record<string, string> = {
  under_review: 'triaging',
  matched: 'approved',
  waiting_for_client: 'in_progress',
  waiting_for_vendor: 'in_progress',
  on_hold: 'in_progress',
  reopened: 'new',
  cancelled: 'closed',
};

interface Props {
  currentStatus: string;
}

export default function TicketStatusStepper({ currentStatus }: Props) {
  const mappedStatus = STATUS_MAP[currentStatus] || currentStatus;
  const currentIdx = WORKFLOW_STEPS.findIndex(s => s.key === mappedStatus);

  return (
    <div className="w-full overflow-x-auto scrollbar-hide">
      <div className="flex items-center gap-0 min-w-max px-1 py-2">
        {WORKFLOW_STEPS.map((step, idx) => {
          const isPast = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;

          return (
            <div key={step.key} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div className={`
                  w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold transition-all
                  ${isPast ? `${step.color} opacity-60` : ''}
                  ${isCurrent ? `${step.color} ring-2 ring-offset-2 ring-offset-background ring-${step.color.replace('bg-', '')} shadow-lg scale-110` : ''}
                  ${isFuture ? 'bg-muted/40 text-muted-foreground' : ''}
                `}>
                  {isPast ? <CheckCircle2 className="w-4 h-4" /> : (idx + 1)}
                </div>
                <span className={`text-[9px] font-medium whitespace-nowrap ${
                  isCurrent ? 'text-foreground' : 'text-muted-foreground'
                }`}>
                  {step.label}
                </span>
              </div>
              {idx < WORKFLOW_STEPS.length - 1 && (
                <div className={`w-6 h-0.5 mx-0.5 mt-[-14px] rounded-full ${
                  idx < currentIdx ? 'bg-primary/40' : 'bg-muted/30'
                }`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Special status badge */}
      {STATUS_MAP[currentStatus] && (
        <div className="flex justify-center mt-1">
          <Badge variant="secondary" className="text-[10px] gap-1">
            <Circle className="w-2.5 h-2.5 fill-current" />
            {currentStatus.replace(/_/g, ' ')}
          </Badge>
        </div>
      )}
    </div>
  );
}
