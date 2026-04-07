import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface Props {
  sessionId: string;
  aiSummary?: string | null;
  aiActionItems?: string[] | null;
}

export default function MeetingMinutesCard({ sessionId, aiSummary, aiActionItems }: Props) {
  const { data: feedback, isLoading } = useQuery({
    queryKey: ['session-mom', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('session_feedback')
        .select('mom_content, action_items, strengths, improvements')
        .eq('session_id', sessionId)
        .eq('recipient_role', 'client')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!sessionId,
  });

  const hasMoM = feedback?.mom_content || aiSummary;

  if (isLoading) {
    return (
      <Card className="rounded-2xl border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" /> Meeting Minutes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!hasMoM) return null;

  const actionItems = feedback?.action_items as string[] | null || aiActionItems || [];

  return (
    <Card className="rounded-2xl border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" /> Meeting Minutes
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] gap-1">
            <CheckCircle2 className="w-3 h-3" /> AI Generated
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Full MoM content (markdown) */}
        {feedback?.mom_content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground">
            <ReactMarkdown>{feedback.mom_content}</ReactMarkdown>
          </div>
        ) : aiSummary ? (
          <p className="text-sm text-muted-foreground leading-relaxed">{aiSummary}</p>
        ) : null}

        {/* Action items with checkboxes */}
        {actionItems.length > 0 && (
          <div className="border-t border-border/30 pt-3">
            <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-accent" />
              Action Items ({actionItems.length})
            </p>
            <ul className="space-y-1.5">
              {actionItems.map((item: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <span className="w-5 h-5 rounded-md bg-accent/10 flex items-center justify-center text-[10px] font-bold text-accent shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Strengths & Improvements */}
        {(feedback?.strengths as string[] || []).length > 0 && (
          <div className="border-t border-border/30 pt-3">
            <p className="text-xs font-semibold text-foreground mb-1.5">Strengths</p>
            <div className="flex flex-wrap gap-1.5">
              {(feedback!.strengths as string[]).map((s: string, i: number) => (
                <Badge key={i} variant="outline" className="text-xs bg-primary/5">{s}</Badge>
              ))}
            </div>
          </div>
        )}
        {(feedback?.improvements as string[] || []).length > 0 && (
          <div className="border-t border-border/30 pt-3">
            <p className="text-xs font-semibold text-foreground mb-1.5">Areas for Improvement</p>
            <div className="flex flex-wrap gap-1.5">
              {(feedback!.improvements as string[]).map((s: string, i: number) => (
                <Badge key={i} variant="outline" className="text-xs bg-destructive/5 text-destructive">{s}</Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
