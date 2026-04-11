import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Star, MessageSquare, Zap, Clock, UserCheck, ThumbsUp } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (scores: { communication: number; technicalQuality: number; timeliness: number; professionalism: number; overall: number; comment?: string }) => void;
  isPending?: boolean;
  targetName?: string;
}

const dimensions = [
  { key: 'communication', icon: MessageSquare, label: 'Communication', desc: 'Clarity and responsiveness' },
  { key: 'technicalQuality', icon: Zap, label: 'Technical Quality', desc: 'Expertise and solution quality' },
  { key: 'timeliness', icon: Clock, label: 'Timeliness', desc: 'Punctuality and delivery speed' },
  { key: 'professionalism', icon: UserCheck, label: 'Professionalism', desc: 'Conduct and work ethic' },
  { key: 'overall', icon: ThumbsUp, label: 'Overall Satisfaction', desc: 'Your overall experience' },
] as const;

type ScoreKey = typeof dimensions[number]['key'];

export default function SatisfactionSurveyDialog({ open, onOpenChange, onSubmit, isPending, targetName }: Props) {
  const { t } = useTranslation();
  const [scores, setScores] = useState<Record<ScoreKey, number>>({
    communication: 0, technicalQuality: 0, timeliness: 0, professionalism: 0, overall: 0,
  });
  const [hoveredStars, setHoveredStars] = useState<Record<ScoreKey, number>>({
    communication: 0, technicalQuality: 0, timeliness: 0, professionalism: 0, overall: 0,
  });
  const [comment, setComment] = useState('');

  const allRated = Object.values(scores).every(s => s > 0);

  const handleSubmit = () => {
    onSubmit({ ...scores, comment: comment.trim() || undefined });
    // Reset
    setScores({ communication: 0, technicalQuality: 0, timeliness: 0, professionalism: 0, overall: 0 });
    setComment('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="w-5 h-5 text-primary" />
            {t('csat.title', 'Satisfaction Survey')}
          </DialogTitle>
          {targetName && (
            <p className="text-sm text-muted-foreground">
              {t('csat.rate_target', 'Rate your experience with {{name}}', { name: targetName })}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {dimensions.map(dim => {
            const Icon = dim.icon;
            const score = scores[dim.key];
            const hovered = hoveredStars[dim.key];
            return (
              <div key={dim.key} className="rounded-xl border border-border/40 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-primary" />
                  <Label className="text-sm font-semibold">{dim.label}</Label>
                </div>
                <p className="text-xs text-muted-foreground">{dim.desc}</p>
                <div className="flex gap-1 mt-1">
                  {[1, 2, 3, 4, 5].map(s => (
                    <button
                      key={s}
                      onClick={() => setScores(prev => ({ ...prev, [dim.key]: s }))}
                      onMouseEnter={() => setHoveredStars(prev => ({ ...prev, [dim.key]: s }))}
                      onMouseLeave={() => setHoveredStars(prev => ({ ...prev, [dim.key]: 0 }))}
                      className="p-0.5 transition-transform hover:scale-110"
                    >
                      <Star
                        className={`w-6 h-6 transition-colors ${
                          s <= (hovered || score)
                            ? 'text-yellow-500 fill-yellow-500'
                            : 'text-muted-foreground/25'
                        }`}
                      />
                    </button>
                  ))}
                  {score > 0 && (
                    <span className="text-xs text-muted-foreground ms-2 self-center">{score}/5</span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="space-y-2">
            <Label className="text-sm">{t('csat.comment', 'Additional feedback (optional)')}</Label>
            <Textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={t('csat.comment_placeholder', 'Share any additional thoughts...')}
              className="min-h-[70px]"
            />
          </div>

          <Button
            className="w-full gradient-primary border-0"
            onClick={handleSubmit}
            disabled={isPending || !allRated}
          >
            {isPending ? t('csat.submitting', 'Submitting...') : t('csat.submit', 'Submit Survey')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
