import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Brain, Play, SkipForward, CheckCircle } from 'lucide-react';
import AIInterviewFlow from '@/components/consultant/AIInterviewFlow';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { toast } from 'sonner';

interface Props {
  onInterviewComplete: () => void;
  consultantId?: string;
}

export default function InterviewStep({ onInterviewComplete, consultantId }: Props) {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [completed, setCompleted] = useState(false);

  const startInterview = async () => {
    if (isGuest) {
      toast.success('Demo: AI Interview would start here');
      setCompleted(true);
      onInterviewComplete();
      return;
    }

    if (!consultantId) {
      toast.error('Please complete previous steps first');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('interview_sessions')
        .insert({
          consultant_id: consultantId,
          status: 'pending',
          interview_type: 'ai',
        })
        .select('id')
        .single();
      if (error) throw error;
      setInterviewId(data.id);
      setStarted(true);
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to start interview');
    }
  };

  if (completed) {
    return (
      <Card className="p-6 text-center space-y-4">
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto" />
        <h3 className="text-lg font-semibold">Interview Complete!</h3>
        <p className="text-sm text-muted-foreground">
          Your AI interview has been submitted. Results will be factored into your profile verification.
        </p>
      </Card>
    );
  }

  if (started && interviewId) {
    return (
      <AIInterviewFlow
        interviewId={interviewId}
        onComplete={() => {
          setCompleted(true);
          onInterviewComplete();
        }}
        onCancel={() => setStarted(false)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-6 text-center space-y-4">
        <Brain className="w-12 h-12 text-primary mx-auto" />
        <h3 className="text-lg font-semibold">AI Skills Assessment</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Take a quick AI-powered interview to verify your SAP skills. The assessment consists of 6 tailored questions based on your expertise. It typically takes 15-20 minutes.
        </p>

        <div className="grid grid-cols-3 gap-3 text-center max-w-sm mx-auto">
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-lg font-bold text-foreground">6</p>
            <p className="text-[10px] text-muted-foreground">Questions</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-lg font-bold text-foreground">~15</p>
            <p className="text-[10px] text-muted-foreground">Minutes</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-lg font-bold text-foreground">AI</p>
            <p className="text-[10px] text-muted-foreground">Scored</p>
          </div>
        </div>

        <div className="flex gap-3 justify-center pt-2">
          <Button variant="outline" onClick={onInterviewComplete} className="gap-1.5">
            <SkipForward className="w-4 h-4" />
            Skip for Now
          </Button>
          <Button onClick={startInterview} className="gap-1.5">
            <Play className="w-4 h-4" />
            Start Interview
          </Button>
        </div>
      </Card>

      <p className="text-xs text-center text-muted-foreground">
        You can always take or retake the interview from your dashboard later.
      </p>
    </div>
  );
}
