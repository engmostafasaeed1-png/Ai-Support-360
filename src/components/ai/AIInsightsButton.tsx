import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sparkles, Loader2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface AIInsightsButtonProps {
  role: 'admin' | 'client' | 'consultant';
  metrics: Record<string, unknown>;
}

export default function AIInsightsButton({ role, metrics }: AIInsightsButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState('');

  const fetchInsights = useCallback(async () => {
    setContent('');
    setLoading(true);

    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-dashboard-insights`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ role, metrics }),
      });

      if (resp.status === 429) {
        setContent('⚠️ AI is busy, please try again in a moment.');
        setLoading(false);
        return;
      }
      if (resp.status === 402) {
        setContent('⚠️ AI credits exhausted. Please add funds in Settings.');
        setLoading(false);
        return;
      }
      if (!resp.ok || !resp.body) {
        setContent('❌ Failed to generate insights. Please try again.');
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              accumulated += delta;
              setContent(accumulated);
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }
    } catch {
      setContent('❌ Failed to connect. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [role, metrics]);

  const handleOpen = () => {
    setOpen(true);
    fetchInsights();
  };

  return (
    <>
      <Button onClick={handleOpen} variant="outline" size="sm" className="gap-1.5">
        <Sparkles className="w-4 h-4" />
        <span className="hidden sm:inline">AI Insights</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              AI Dashboard Insights
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2">
            {loading && !content && (
              <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Analyzing your data...</span>
              </div>
            )}
            {content && (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            )}
            {!loading && content && (
              <div className="mt-4 flex justify-end">
                <Button variant="ghost" size="sm" onClick={fetchInsights} className="gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Regenerate
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
